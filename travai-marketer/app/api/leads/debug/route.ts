import { NextResponse } from 'next/server';
import { getDatabaseClient, APPWRITE_DATABASE_ID } from '@/lib/appwrite';
import { getActiveDataBackend } from '@/lib/data-backend';
import { Query } from 'node-appwrite';

/**
 * GET /api/leads/debug
 * Returns raw diagnostic info from Appwrite to surface why leads are not showing.
 */
export async function GET() {
  if (getActiveDataBackend() === 'pocketbase') {
    return NextResponse.json({
      disabled: true,
      backend: 'pocketbase',
      message: 'Appwrite leads debug is disabled because production uses PocketBase.',
    });
  }

  const db = getDatabaseClient();
  const result: Record<string, unknown> = {
    databaseId: APPWRITE_DATABASE_ID,
    collectionId: 'leads',
  };

  // 1. Try listing — no filters, just check if collection exists and is readable
  try {
    const list = await db.listDocuments(APPWRITE_DATABASE_ID, 'leads', [
      Query.limit(5),
    ]);
    result.listSuccess = true;
    result.total = list.total;
    result.sample = list.documents.slice(0, 2);
  } catch (err: unknown) {
    result.listSuccess = false;
    result.listError = err instanceof Error ? err.message : String(err);
  }

  // 2. Try a simple create then delete to check write permission and schema
  const testId = `debug_${Date.now()}`;
  try {
    const created = await db.createDocument(APPWRITE_DATABASE_ID, 'leads', testId, {
      teamId: 'debug',
      phone: '0000000000',
      name: 'Debug Test',
      email: null,
      source: 'debug',
      status: 'new_lead',
      notes: 'debug probe',
      lastContactedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    result.writeSuccess = true;
    result.writtenId = created.$id;

    // Clean up the test doc
    await db.deleteDocument(APPWRITE_DATABASE_ID, 'leads', created.$id).catch(() => {});
  } catch (err: unknown) {
    result.writeSuccess = false;
    result.writeError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(result);
}
