import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  CRM_STATUS_ORDER,
  buildPhoneVariants,
  coerceLeadStatus,
  deriveLeadStatus,
  getPreferredLeadName,
  mergeLeadStatus,
  normalizePhoneForMatch,
  type CrmLeadStatus,
} from '@/lib/crm';

type LocalDocument = Record<string, any>;

type LocalStore = {
  version: number;
  updatedAt: string;
  bootstrappedFromLogsAt?: string;
  collections: Record<string, LocalDocument[]>;
};

const STORE_VERSION = 1;
const STORE_FILE = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  '.local-cache',
  'local-crm-store.json'
);
const LOG_BOOTSTRAP_LINE_LIMIT = Math.max(
  200,
  Number(process.env.LOCAL_CRM_BOOTSTRAP_LOG_LINES || '4000')
);
const DEFAULT_TEAM_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
const LOG_PATH = (
  process.env.LOCAL_CRM_BOOTSTRAP_LOG_PATH ||
  path.join(os.homedir(), '.pm2', 'logs', 'travai-app-out-0.log')
).trim();

let memoryStore: LocalStore | null = null;
let writeChain = Promise.resolve();

function emptyStore(): LocalStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date(0).toISOString(),
    collections: {},
  };
}

function ensureCollection(store: LocalStore, collectionId: string) {
  if (!Array.isArray(store.collections[collectionId])) {
    store.collections[collectionId] = [];
  }
  return store.collections[collectionId];
}

function normalizeDocTimestamp(doc: LocalDocument): string {
  return String(doc.updatedAt || doc.createdAt || doc.$updatedAt || doc.$createdAt || new Date().toISOString());
}

function compareDocsByRecency(a: LocalDocument, b: LocalDocument) {
  return new Date(normalizeDocTimestamp(b)).getTime() - new Date(normalizeDocTimestamp(a)).getTime();
}

function parseQuery(rawQuery: string): Record<string, any> | null {
  if (!rawQuery || typeof rawQuery !== 'string') return null;
  try {
    return JSON.parse(rawQuery) as Record<string, any>;
  } catch {
    return null;
  }
}

function getComparableField(doc: LocalDocument, attribute: string) {
  if (attribute === '$createdAt') return doc.$createdAt || doc.createdAt || null;
  if (attribute === '$updatedAt') return doc.$updatedAt || doc.updatedAt || null;
  return doc[attribute];
}

function matchesEqualQuery(doc: LocalDocument, attribute: string, values: unknown[]) {
  const actual = getComparableField(doc, attribute);
  if (Array.isArray(actual)) {
    return actual.some((value) => values.includes(value));
  }
  return values.includes(actual);
}

function applyQueries(documents: LocalDocument[], queries: string[]) {
  let filtered = [...documents];
  let offset = 0;
  let limit = filtered.length;
  let orderAttribute: string | null = null;
  let orderDirection: 'asc' | 'desc' | null = null;

  for (const rawQuery of queries) {
    const query = parseQuery(rawQuery);
    if (!query?.method) continue;

    if (query.method === 'equal') {
      filtered = filtered.filter((doc) =>
        matchesEqualQuery(doc, String(query.attribute || ''), Array.isArray(query.values) ? query.values : [])
      );
      continue;
    }

    if (query.method === 'limit') {
      limit = Math.max(0, Number(query.values?.[0] ?? filtered.length));
      continue;
    }

    if (query.method === 'offset') {
      offset = Math.max(0, Number(query.values?.[0] ?? 0));
      continue;
    }

    if (query.method === 'orderDesc' || query.method === 'orderAsc') {
      orderAttribute = String(query.attribute || '$createdAt');
      orderDirection = query.method === 'orderDesc' ? 'desc' : 'asc';
    }
  }

  if (orderAttribute && orderDirection) {
    filtered.sort((a, b) => {
      const aValue = getComparableField(a, orderAttribute);
      const bValue = getComparableField(b, orderAttribute);
      const aTime = new Date(String(aValue || 0)).getTime();
      const bTime = new Date(String(bValue || 0)).getTime();
      return orderDirection === 'desc' ? bTime - aTime : aTime - bTime;
    });
  }

  const total = filtered.length;
  return {
    total,
    documents: filtered.slice(offset, offset + limit),
  };
}

function extractBootstrapName(message: string, phone: string): string | null {
  const safe = String(message || '').trim();
  if (!safe) return null;

  const directName =
    safe.match(/\bmy name is\s+([a-z][a-z\s.'-]{1,50})$/i)?.[1] ||
    safe.match(/^([a-z][a-z\s.'-]{1,50}),\s*(?:91)?\d{10,}$/i)?.[1] ||
    safe.match(/^([a-z][a-z\s.'-]{1,50})\s+is my full name$/i)?.[1];

  const normalized = directName?.replace(/\s+/g, ' ').trim() || null;
  return getPreferredLeadName({ customerName: normalized, phone });
}

function inferLeadStatusFromHistory(history: LocalDocument[]): CrmLeadStatus {
  const ordered = [...history].sort((a, b) => {
    const aTs = new Date(String(a.createdAt || a.$createdAt || 0)).getTime();
    const bTs = new Date(String(b.createdAt || b.$createdAt || 0)).getTime();
    return aTs - bTs;
  });

  let current: CrmLeadStatus = 'new_lead';
  let inboundCount = 0;

  for (const conversation of ordered) {
    const isIncoming = conversation.role === 'user' || conversation.sentBy === 'customer';
    if (!isIncoming) continue;
    inboundCount += 1;
    current = mergeLeadStatus(
      current,
      deriveLeadStatus({
        existingStatus: current,
        isFirstLead: inboundCount === 1,
        userMessage: String(conversation.message || ''),
      })
    );
  }

  if (current === 'new_lead' && inboundCount > 1) {
    return 'normal_conversation';
  }

  return current;
}

function buildLogBootstrapStore(logText: string): LocalStore {
  const store = emptyStore();
  const leads = ensureCollection(store, 'leads');
  const customers = ensureCollection(store, 'customers');
  const conversations = ensureCollection(store, 'conversations');
  const customerByPhone = new Map<string, LocalDocument>();
  const leadByPhone = new Map<string, LocalDocument>();
  const historyByPhone = new Map<string, LocalDocument[]>();

  const incomingRegex = /^\[Incoming\] Incoming ([a-z_]+) message from (\d+):\s*(.*)$/i;
  const outgoingRegex = /^\[OK\] (Greeting|AI response|Deterministic reply) sent to (\d+)(?:\s+via.*|\s+\(stage=([^)]+)\))?/i;
  const lines = logText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-LOG_BOOTSTRAP_LINE_LIMIT);

  const baseTs = Date.now() - lines.length * 15000;
  let seq = 0;

  for (const line of lines) {
    const incomingMatch = line.match(incomingRegex);
    if (incomingMatch) {
      const [, messageType, phone, message] = incomingMatch;
      const createdAt = new Date(baseTs + seq * 15000).toISOString();
      const doc: LocalDocument = {
        $id: `bootstrap-in-${seq}-${phone}`,
        teamId: DEFAULT_TEAM_ID,
        phone,
        role: 'user',
        sentBy: 'customer',
        message: message || null,
        messageType: (messageType || 'text').toLowerCase(),
        createdAt,
        $createdAt: createdAt,
      };
      conversations.push(doc);
      const bucket = historyByPhone.get(phone) || [];
      bucket.push(doc);
      historyByPhone.set(phone, bucket);

      const candidateName = extractBootstrapName(message, phone);
      if (candidateName) {
        const customer = customerByPhone.get(phone) || {
          $id: `bootstrap-customer-${phone}`,
          teamId: DEFAULT_TEAM_ID,
          phone,
          createdAt,
          updatedAt: createdAt,
        };
        customer.name = candidateName;
        customer.updatedAt = createdAt;
        customerByPhone.set(phone, customer);
      }

      seq += 1;
      continue;
    }

    const outgoingMatch = line.match(outgoingRegex);
    if (!outgoingMatch) continue;

    const [, kind, phone, stage] = outgoingMatch;
    const createdAt = new Date(baseTs + seq * 15000).toISOString();
    const message =
      kind === 'Greeting'
        ? 'Greeting sent'
        : stage
          ? `AI reply sent (${stage})`
          : 'AI reply sent';
    const doc: LocalDocument = {
      $id: `bootstrap-out-${seq}-${phone}`,
      teamId: DEFAULT_TEAM_ID,
      phone,
      role: 'assistant',
      sentBy: 'ai',
      message,
      messageType: 'text',
      createdAt,
      $createdAt: createdAt,
    };
    conversations.push(doc);
    const bucket = historyByPhone.get(phone) || [];
    bucket.push(doc);
    historyByPhone.set(phone, bucket);
    seq += 1;
  }

  for (const [phone, history] of historyByPhone.entries()) {
    const latest = [...history].sort(compareDocsByRecency)[0];
    const name = getPreferredLeadName({
      customerName: customerByPhone.get(phone)?.name || null,
      phone,
    });
    const status = inferLeadStatusFromHistory(history);
    const lead: LocalDocument = {
      $id: `bootstrap-lead-${phone}`,
      teamId: DEFAULT_TEAM_ID,
      phone,
      name,
      email: null,
      source: 'whatsapp',
      status,
      notes: String(latest?.message || '').trim() || null,
      lastContactedAt: latest?.createdAt || latest?.$createdAt || new Date().toISOString(),
      createdAt: history[0]?.createdAt || history[0]?.$createdAt || new Date().toISOString(),
      updatedAt: latest?.createdAt || latest?.$createdAt || new Date().toISOString(),
      $createdAt: history[0]?.createdAt || history[0]?.$createdAt || new Date().toISOString(),
    };
    leads.push(lead);
    leadByPhone.set(phone, lead);
  }

  for (const customer of customerByPhone.values()) {
    customers.push(customer);
  }

  store.updatedAt = new Date().toISOString();
  store.bootstrappedFromLogsAt = store.updatedAt;
  return store;
}

async function readStoreFromDisk(): Promise<LocalStore> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LocalStore;
    if (parsed && typeof parsed === 'object' && parsed.collections) {
      return {
        version: STORE_VERSION,
        updatedAt: String(parsed.updatedAt || new Date().toISOString()),
        bootstrappedFromLogsAt: parsed.bootstrappedFromLogsAt,
        collections: parsed.collections,
      };
    }
  } catch {
    return emptyStore();
  }
  return emptyStore();
}

async function writeStoreToDisk(store: LocalStore) {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

async function maybeBootstrapStore(store: LocalStore) {
  const hasAnyData = Object.values(store.collections).some(
    (documents) => Array.isArray(documents) && documents.length > 0
  );
  if (hasAnyData || store.bootstrappedFromLogsAt) {
    return store;
  }

  try {
    const logText = await fs.readFile(LOG_PATH, 'utf8');
    const bootstrapped = buildLogBootstrapStore(logText);
    if (Object.values(bootstrapped.collections).some((documents) => documents.length > 0)) {
      await writeStoreToDisk(bootstrapped);
      return bootstrapped;
    }
  } catch {
    return store;
  }

  return store;
}

async function loadStore(): Promise<LocalStore> {
  if (memoryStore) {
    return memoryStore;
  }
  const fromDisk = await readStoreFromDisk();
  memoryStore = await maybeBootstrapStore(fromDisk);
  return memoryStore;
}

async function commitStore(mutator: (store: LocalStore) => void | Promise<void>) {
  writeChain = writeChain.then(async () => {
    const store = await loadStore();
    await mutator(store);
    store.updatedAt = new Date().toISOString();
    memoryStore = store;
    await writeStoreToDisk(store);
  });
  await writeChain;
  return memoryStore as LocalStore;
}

export function isAppwriteReadLimitError(error: unknown): boolean {
  const candidate = error as { code?: number; type?: string; message?: string; response?: { type?: string; message?: string } };
  const message = String(
    candidate?.message || candidate?.response?.message || ''
  ).toLowerCase();
  const type = String(candidate?.type || candidate?.response?.type || '').toLowerCase();
  return (
    candidate?.code === 402 &&
    (type.includes('limit_databases_reads_exceeded') || message.includes('reads limit'))
  );
}

export async function upsertLocalDocument(collectionId: string, document: LocalDocument | null | undefined) {
  if (!document || !document.$id) return;
  await commitStore((store) => {
    const collection = ensureCollection(store, collectionId);
    const index = collection.findIndex((item) => item.$id === document.$id);
    if (index >= 0) {
      collection[index] = { ...collection[index], ...document };
    } else {
      collection.push(document);
    }
  });
}

export async function removeLocalDocument(collectionId: string, documentId: string) {
  if (!documentId) return;
  await commitStore((store) => {
    const collection = ensureCollection(store, collectionId);
    store.collections[collectionId] = collection.filter((item) => item.$id !== documentId);
  });
}

export async function queryLocalDocuments(collectionId: string, queries: string[] = []) {
  const store = await loadStore();
  const collection = ensureCollection(store, collectionId);
  return applyQueries(collection, queries);
}

export async function getLocalDocument(collectionId: string, documentId: string) {
  const store = await loadStore();
  const collection = ensureCollection(store, collectionId);
  return collection.find((item) => item.$id === documentId) || null;
}

export async function getLocalStoreSummary() {
  const store = await loadStore();
  return {
    updatedAt: store.updatedAt,
    bootstrappedFromLogsAt: store.bootstrappedFromLogsAt || null,
    collections: Object.fromEntries(
      Object.entries(store.collections).map(([collectionId, documents]) => [
        collectionId,
        Array.isArray(documents) ? documents.length : 0,
      ])
    ),
  };
}

export function summarizeLocalLeadStatuses(documents: LocalDocument[]) {
  const counts = Object.fromEntries(CRM_STATUS_ORDER.map((status) => [status, 0])) as Record<
    CrmLeadStatus,
    number
  >;
  for (const document of documents) {
    counts[coerceLeadStatus(document.status)] += 1;
  }
  return counts;
}

export function normalizeLocalPhoneVariants(phone: string | null | undefined) {
  return buildPhoneVariants(phone).map((value) => normalizePhoneForMatch(value)).filter(Boolean);
}
