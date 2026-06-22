import { createHash } from 'crypto';
import { Query } from 'node-appwrite';
import { getDatabaseClient } from '@/lib/appwrite';
import { getPocketBaseAdmin } from '@/lib/pocketbase-server';
import { extractKeywords } from '@/lib/travel-knowledge';
import {
  isConfidentialOrBlockedRoutePath,
  isCustomerSafeRoutePath,
} from '@/lib/whatsapp-bot-routing';

const WEBSITE_BASE_URL =
  process.env.TRAVENTIONS_WEBSITE_URL || 'https://traventions-ai.vercel.app';
const SECONDARY_DATABASE_ID =
  (process.env.WA_KNOWLEDGE_SECONDARY_DATABASE_ID || '').trim() || '696e96950008a6b5cddd';

const WEBSITE_MAX_PAGES = 18;
const APPWRITE_BATCH_SIZE = 100;
const APPWRITE_COLLECTIONS = [
  'featured_itineraries',
  'destinations',
  'promotions',
  'chat_response_templates',
  'itineraries',
  'itinerary_days',
  'itinerary_activities',
  'itinerary_hotels',
  'hotel_options',
  'flight_options',
] as const;

type WebsiteKnowledgeRecord = {
  id: string;
  isActive?: boolean;
  lastSyncedAt?: string;
};

type WebsitePage = {
  url: string;
  title: string;
  excerpt: string;
  content: string;
};

export type KnowledgeStatus = {
  totalRecords: number;
  activeRecords: number;
  lastSyncedAt: string | null;
};

export type TrainKnowledgeSummary = KnowledgeStatus & {
  websitePagesImported: number;
  appwriteRecordsImported: number;
  upserted: number;
  updated: number;
  skipped: number;
  collections: Record<string, number>;
  sourceDatabaseId: string;
};

function normalizeUrl(url: string): string | null {
  try {
    const base = new URL(WEBSITE_BASE_URL);
    const parsed = new URL(url, base.origin);
    if (parsed.origin !== base.origin) return null;
    if (
      /\.(png|jpg|jpeg|gif|svg|webp|ico|pdf|xml|txt|woff|woff2|ttf|css|js)$/i.test(
        parsed.pathname
      )
    ) {
      return null;
    }
    if (isConfidentialOrBlockedRoutePath(parsed.pathname)) {
      return null;
    }
    if (!isCustomerSafeRoutePath(parsed.pathname)) {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinks(html: string) {
  const links: string[] = [];
  const regex = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = regex.exec(html);
    if (!match) break;
    links.push(match[1]);
  }
  return links;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'trav-ai-knowledge-sync/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function crawlWebsitePages() {
  const start = normalizeUrl(WEBSITE_BASE_URL) || WEBSITE_BASE_URL;
  const queue = [start];
  const visited = new Set<string>();
  const pages: WebsitePage[] = [];

  while (queue.length > 0 && pages.length < WEBSITE_MAX_PAGES) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const html = await fetchHtml(current);
    if (!html) continue;

    const content = stripHtml(html).slice(0, 120000);
    if (!content) continue;

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (titleMatch?.[1] || '').trim() || 'Traventions';

    pages.push({
      url: current,
      title,
      excerpt: content.slice(0, 900),
      content,
    });

    for (const raw of extractLinks(html)) {
      const normalized = normalizeUrl(raw);
      if (!normalized || visited.has(normalized) || queue.includes(normalized)) continue;
      queue.push(normalized);
    }
  }

  return pages;
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function buildAppwriteKnowledgeContent(collectionId: string, doc: Record<string, unknown>) {
  const preferredKeys = [
    'title',
    'name',
    'packageName',
    'destination',
    'country',
    'city',
    'category',
    'duration',
    'days',
    'nights',
    'price',
    'budget',
    'hotelName',
    'flightNumber',
    'summary',
    'highlights',
    'inclusions',
    'exclusions',
    'description',
    'content',
    'notes',
    'tags',
  ];

  const ignoreKeys = new Set([
    '$id',
    '$databaseId',
    '$collectionId',
    '$permissions',
    '$createdAt',
    '$updatedAt',
    'createdAt',
    'updatedAt',
    'teamId',
  ]);

  const chunks: string[] = [`Collection: ${collectionId}`];
  for (const key of preferredKeys) {
    if (!(key in doc)) continue;
    const text = stringifyValue(doc[key]).trim();
    if (text) {
      chunks.push(`${key}: ${text}`);
    }
  }

  if (chunks.length <= 1) {
    for (const [key, value] of Object.entries(doc)) {
      if (ignoreKeys.has(key)) continue;
      const text = stringifyValue(value).trim();
      if (!text) continue;
      chunks.push(`${key}: ${text}`);
      if (chunks.length >= 16) break;
    }
  }

  return chunks.join('\n').slice(0, 120000);
}

function buildContentHash(sourceUrl: string, content: string) {
  return createHash('sha256').update(`${sourceUrl}\n${content}`).digest('hex');
}

function buildKnowledgeTags(seedText: string, fallback: string[]) {
  return Array.from(new Set([...extractKeywords(seedText), ...fallback])).slice(0, 16);
}

async function fetchAllAppwriteDocs(databaseId: string, collectionId: string) {
  const db = getDatabaseClient();
  const all: Array<Record<string, unknown>> = [];
  let offset = 0;

  while (true) {
    const result = await db.listDocuments(databaseId, collectionId, [
      Query.limit(APPWRITE_BATCH_SIZE),
      Query.offset(offset),
    ]);
    const docs = (result.documents || []) as Array<Record<string, unknown>>;
    all.push(...docs);
    if (docs.length < APPWRITE_BATCH_SIZE) {
      break;
    }
    offset += docs.length;
  }

  return all;
}

async function upsertKnowledgeRecord(params: {
  teamId: string;
  sourceUrl: string;
  pageTitle: string;
  excerpt: string;
  content: string;
  tags: string[];
  syncedAt: string;
}) {
  const pb = await getPocketBaseAdmin();
  const contentHash = buildContentHash(params.sourceUrl, params.content);
  const payload = {
    teamId: params.teamId,
    sourceUrl: params.sourceUrl,
    pageTitle: params.pageTitle,
    excerpt: params.excerpt.slice(0, 4000),
    content: params.content.slice(0, 120000),
    tags: params.tags,
    contentHash,
    isActive: true,
    lastSyncedAt: params.syncedAt,
    updatedAt: params.syncedAt,
  };

  try {
    const existing = (await pb
      .collection('website_knowledge')
      .getFirstListItem(`contentHash = "${contentHash}"`)) as WebsiteKnowledgeRecord;

    await pb.collection('website_knowledge').update(existing.id, payload);
    return { action: 'updated' as const };
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 0);
    if (status && status !== 404) {
      throw error;
    }
  }

  await pb.collection('website_knowledge').create({
    ...payload,
    createdAt: params.syncedAt,
  });
  return { action: 'created' as const };
}

export async function getKnowledgeTrainingStatus(teamId: string): Promise<KnowledgeStatus> {
  const pb = await getPocketBaseAdmin();
  const records = (await pb.collection('website_knowledge').getFullList({
    filter: `teamId = "${teamId.replace(/"/g, '\\"')}"`,
    sort: '-lastSyncedAt',
    fields: 'id,isActive,lastSyncedAt',
  })) as WebsiteKnowledgeRecord[];

  return {
    totalRecords: records.length,
    activeRecords: records.filter((record) => record.isActive !== false).length,
    lastSyncedAt: records[0]?.lastSyncedAt || null,
  };
}

export async function trainKnowledgeBase(teamId: string): Promise<TrainKnowledgeSummary> {
  const syncedAt = new Date().toISOString();
  const websitePages = await crawlWebsitePages();
  const collections: Record<string, number> = {};
  let websitePagesImported = 0;
  let appwriteRecordsImported = 0;
  let upserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const page of websitePages) {
    if (!page.content.trim()) {
      skipped += 1;
      continue;
    }
    const result = await upsertKnowledgeRecord({
      teamId,
      sourceUrl: page.url,
      pageTitle: page.title,
      excerpt: page.excerpt,
      content: page.content,
      tags: buildKnowledgeTags(`${page.title} ${page.excerpt}`, ['website', 'traventions']),
      syncedAt,
    });
    websitePagesImported += 1;
    if (result.action === 'created') upserted += 1;
    if (result.action === 'updated') updated += 1;
  }

  for (const collectionId of APPWRITE_COLLECTIONS) {
    try {
      const docs = await fetchAllAppwriteDocs(SECONDARY_DATABASE_ID, collectionId);
      collections[collectionId] = docs.length;
      for (const doc of docs) {
        const content = buildAppwriteKnowledgeContent(collectionId, doc);
        if (!content.trim()) {
          skipped += 1;
          continue;
        }

        const sourceUrl = `https://appwrite.local/${SECONDARY_DATABASE_ID}/${collectionId}/${String(doc.$id || '')}`;
        const pageTitle =
          stringifyValue(doc.title).trim() ||
          stringifyValue(doc.name).trim() ||
          `${collectionId} knowledge`;

        const result = await upsertKnowledgeRecord({
          teamId,
          sourceUrl,
          pageTitle,
          excerpt: content.slice(0, 900),
          content,
          tags: buildKnowledgeTags(`${collectionId} ${content.slice(0, 200)}`, [
            'appwrite',
            collectionId,
          ]),
          syncedAt,
        });
        appwriteRecordsImported += 1;
        if (result.action === 'created') upserted += 1;
        if (result.action === 'updated') updated += 1;
      }
    } catch {
      collections[collectionId] = 0;
    }
  }

  const status = await getKnowledgeTrainingStatus(teamId);
  return {
    ...status,
    websitePagesImported,
    appwriteRecordsImported,
    upserted,
    updated,
    skipped,
    collections,
    sourceDatabaseId: SECONDARY_DATABASE_ID,
  };
}
