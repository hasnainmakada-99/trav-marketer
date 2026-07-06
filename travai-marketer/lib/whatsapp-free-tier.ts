import { listDocuments } from '@/lib/appwrite';
import { Query } from 'node-appwrite';

const SERVICE_WINDOW_HOURS = 24;

export async function canSendToPhoneForFree(phone: string): Promise<{ free: boolean; reason: string }> {
  const normalized = phone.replace(/[^\d]/g, '');
  if (!normalized) return { free: false, reason: 'Invalid phone number' };

  const cutoff = new Date(Date.now() - SERVICE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const result = await listDocuments('conversations', [
    Query.equal('phone', normalized),
    Query.equal('role', 'user'),
    Query.greaterThan('createdAt', cutoff),
    Query.limit(1),
  ]);

  const hasRecentInbound = result.total > 0;

  if (hasRecentInbound) {
    return { free: true, reason: `Customer messaged within ${SERVICE_WINDOW_HOURS}h service window` };
  }

  return { free: false, reason: `No customer message in last ${SERVICE_WINDOW_HOURS}h — sending would be a paid business-initiated conversation` };
}
