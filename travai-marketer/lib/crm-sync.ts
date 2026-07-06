import { Query } from 'node-appwrite';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { buildBestLeadPreview } from '@/lib/message-preview';
import { extractCustomerNameFromMessages } from '@/lib/contact-identity';
import {
  CRM_STATUS_ORDER,
  buildPhoneVariants,
  buildStatusCounts,
  coerceLeadStatus,
  deriveLeadStatus,
  getPreferredLeadName,
  mergeLeadStatus,
  normalizePhoneForMatch,
  type CrmLeadStatus,
} from '@/lib/crm';
import { sendLeadNotificationEmail } from '@/lib/email';

type ConversationDoc = {
  $id: string;
  phone?: string;
  teamId?: string;
  customerId?: string;
  role?: 'user' | 'assistant';
  sentBy?: 'customer' | 'ai' | 'staff';
  message?: string | null;
  createdAt?: string;
  $createdAt?: string;
};

type LeadDoc = {
  $id: string;
  teamId?: string;
  phone?: string;
  name?: string | null;
  email?: string | null;
  status?: string | null;
  notes?: string | null;
  lastContactedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type CustomerDoc = {
  $id: string;
  teamId?: string;
  phone?: string;
  name?: string | null;
  email?: string | null;
};

type SyncSummary = {
  scannedPhones: number;
  created: number;
  updated: number;
  skipped: number;
  counts: Record<CrmLeadStatus, number>;
};

function sortLeadsForPreference(a: LeadDoc, b: LeadDoc) {
  const statusDiff =
    CRM_STATUS_ORDER.indexOf(coerceLeadStatus(b.status)) -
    CRM_STATUS_ORDER.indexOf(coerceLeadStatus(a.status));
  if (statusDiff !== 0) {
    return statusDiff;
  }
  return (
    new Date(b.updatedAt || b.createdAt || 0).getTime() -
    new Date(a.updatedAt || a.createdAt || 0).getTime()
  );
}

async function listAllForTeam<T>(collectionId: string, teamId: string) {
  const all: T[] = [];
  const batchSize = 500;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await listDocuments(collectionId, [
      Query.equal('teamId', teamId),
      Query.limit(batchSize),
      Query.offset(offset),
    ]).catch(() => ({ documents: [] as T[] }));

    const documents = (result.documents || []) as T[];
    all.push(...documents);
    if (documents.length < batchSize) {
      break;
    }
    offset += documents.length;
  }

  return all;
}

function isIncomingConversation(conversation: ConversationDoc) {
  return conversation.role === 'user' || conversation.sentBy === 'customer';
}

function inferLeadStatusFromHistory(
  conversations: ConversationDoc[],
  existingStatus?: string | null
): CrmLeadStatus {
  const ordered = [...conversations].sort(
    (a, b) =>
      new Date(a.createdAt || a.$createdAt || 0).getTime() -
      new Date(b.createdAt || b.$createdAt || 0).getTime()
  );

  let resolvedStatus = coerceLeadStatus(existingStatus);
  let incomingCount = 0;
  let sawIncoming = false;

  for (const conversation of ordered) {
    if (!isIncomingConversation(conversation)) {
      continue;
    }

    sawIncoming = true;
    incomingCount += 1;

    const nextStatus = deriveLeadStatus({
      existingStatus: resolvedStatus,
      isFirstLead: incomingCount === 1,
      userMessage: conversation.message || '',
    });

    resolvedStatus = mergeLeadStatus(resolvedStatus, nextStatus);
  }

  if (resolvedStatus === 'new_lead' && sawIncoming && ordered.length > 1) {
    return 'normal_conversation';
  }

  return resolvedStatus;
}

function latestRelevantNote(conversations: ConversationDoc[]) {
  const ordered = [...conversations].sort(
    (a, b) =>
      new Date(b.createdAt || b.$createdAt || 0).getTime() -
      new Date(a.createdAt || a.$createdAt || 0).getTime()
  );
  return buildBestLeadPreview(ordered);
}

function latestConversationTimestamp(conversations: ConversationDoc[]) {
  return conversations.reduce((latest, conversation) => {
    const timestamp = conversation.createdAt || conversation.$createdAt || null;
    if (!timestamp) {
      return latest;
    }
    if (!latest) {
      return timestamp;
    }
    return new Date(timestamp).getTime() > new Date(latest).getTime() ? timestamp : latest;
  }, null as string | null);
}

export async function syncLeadStatusesFromConversations(teamId: string): Promise<SyncSummary> {
  const [conversations, leads, customers] = await Promise.all([
    listAllForTeam<ConversationDoc>('conversations', teamId),
    listAllForTeam<LeadDoc>('leads', teamId),
    listAllForTeam<CustomerDoc>('customers', teamId),
  ]);

  const conversationsByPhone = new Map<string, ConversationDoc[]>();
  for (const conversation of conversations) {
    const normalized = normalizePhoneForMatch(conversation.phone);
    if (!normalized) {
      continue;
    }
    const bucket = conversationsByPhone.get(normalized) || [];
    bucket.push(conversation);
    conversationsByPhone.set(normalized, bucket);
  }

  const leadByPhone = new Map<string, LeadDoc>();
  for (const lead of [...leads].sort(sortLeadsForPreference)) {
    for (const variant of buildPhoneVariants(lead.phone)) {
      if (!leadByPhone.has(variant)) {
        leadByPhone.set(variant, lead);
      }
    }
  }

  const customerByPhone = new Map<string, CustomerDoc>();
  for (const customer of customers) {
    for (const variant of buildPhoneVariants(customer.phone)) {
      if (!customerByPhone.has(variant)) {
        customerByPhone.set(variant, customer);
      }
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const inferredItems: Array<{ status: CrmLeadStatus }> = [];

  for (const [normalizedPhone, history] of conversationsByPhone.entries()) {
    const existingLead = leadByPhone.get(normalizedPhone);
    const customer = customerByPhone.get(normalizedPhone);
    const phone = existingLead?.phone || customer?.phone || history[0]?.phone || normalizedPhone;
    const inferredStatus = inferLeadStatusFromHistory(history, existingLead?.status);
    const inferredName = extractCustomerNameFromMessages(
      history
        .filter((item) => item.role === 'user' || item.sentBy === 'customer')
        .sort(
          (a, b) =>
            new Date(b.createdAt || b.$createdAt || 0).getTime() -
            new Date(a.createdAt || a.$createdAt || 0).getTime()
        ),
      phone
    );
    const name = getPreferredLeadName({
      customerName: customer?.name || inferredName || null,
      leadName: existingLead?.name || inferredName || null,
      phone,
    });
    const email = customer?.email || existingLead?.email || null;
    const notes = latestRelevantNote(history) || existingLead?.notes || null;
    const lastContactedAt = latestConversationTimestamp(history) || existingLead?.lastContactedAt || new Date().toISOString();
    const now = new Date().toISOString();

    inferredItems.push({ status: inferredStatus });

    if (customer?.$id && inferredName && !customer.name) {
      await updateDocument('customers', customer.$id, {
        name: inferredName,
        updatedAt: now,
      }).catch(() => null);
    }

    if (existingLead?.$id) {
      const nextStatus = mergeLeadStatus(existingLead.status, inferredStatus);
      const needsUpdate =
        existingLead.status !== nextStatus ||
        (existingLead.name || null) !== (name || null) ||
        (existingLead.email || null) !== email ||
        (existingLead.notes || null) !== notes ||
        (existingLead.lastContactedAt || null) !== lastContactedAt;

      if (!needsUpdate) {
        skipped += 1;
        continue;
      }

      try {
        await updateDocument('leads', existingLead.$id, {
          name: name || undefined,
          email: email || undefined,
          status: nextStatus,
          notes: notes || undefined,
          lastContactedAt,
          updatedAt: now,
        });
        updated += 1;
      } catch {
        skipped += 1;
      }
      continue;
    }

    const recheckedLeadResult = await listDocuments('leads', [
      Query.equal('teamId', teamId),
      Query.equal('phone', buildPhoneVariants(phone)),
      Query.limit(10),
    ]).catch(() => ({ documents: [] as LeadDoc[] }));

    const recheckedLead = ((recheckedLeadResult.documents || []) as LeadDoc[]).sort(sortLeadsForPreference)[0];

    if (recheckedLead?.$id) {
      try {
        await updateDocument('leads', recheckedLead.$id, {
          name: name || undefined,
          email: email || undefined,
          status: mergeLeadStatus(recheckedLead.status, inferredStatus),
          notes: notes || undefined,
          lastContactedAt,
          updatedAt: now,
        });
        updated += 1;
      } catch {
        skipped += 1;
      }
    } else {
      try {
        await createDocument('leads', {
          teamId,
          phone,
          name: name === phone ? null : name,
          email,
          source: 'whatsapp',
          status: inferredStatus,
          notes,
          lastContactedAt,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
        sendLeadNotificationEmail({
          name: name === phone ? null : name,
          phone,
          source: 'whatsapp',
          notes,
          email,
        });
      } catch {
        skipped += 1;
      }
    }
  }

  return {
    scannedPhones: conversationsByPhone.size,
    created,
    updated,
    skipped,
    counts: buildStatusCounts(inferredItems),
  };
}
