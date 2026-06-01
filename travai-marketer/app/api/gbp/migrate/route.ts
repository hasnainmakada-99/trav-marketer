import { NextResponse } from 'next/server';
import { getBusinessConfigByTeamId } from '@/lib/gbp';
import { listDocuments, updateDocument } from '@/lib/appwrite';
import { Query } from 'node-appwrite';

/**
 * POST /api/gbp/migrate
 * One-time migration: moves the orphaned business_configs document
 * (saved under user.$id during initial OAuth) to the canonical
 * NEXT_PUBLIC_DEFAULT_TEAM_ID.  Idempotent — if the target teamId
 * already has a config this is a no-op.
 */
export async function POST() {
  const targetTeamId = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID;
  if (!targetTeamId) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_DEFAULT_TEAM_ID not set' }, { status: 500 });
  }

  // Already migrated — nothing to do.
  const existing = await getBusinessConfigByTeamId(targetTeamId);
  if (existing?.googleAccessToken) {
    return NextResponse.json({ migrated: false, reason: 'already_configured', teamId: targetTeamId });
  }

  // Find any doc that has a Google access token but is under a different teamId.
  const response = await listDocuments('business_configs', [
    Query.isNotNull('googleAccessToken'),
    Query.limit(1),
  ]);

  if (!response.documents.length) {
    return NextResponse.json({ migrated: false, reason: 'no_google_config_found' });
  }

  const orphan = response.documents[0] as unknown as { $id: string; teamId: string };
  if (orphan.teamId === targetTeamId) {
    return NextResponse.json({ migrated: false, reason: 'already_correct_team_id' });
  }

  await updateDocument('business_configs', orphan.$id, {
    teamId: targetTeamId,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ migrated: true, from: orphan.teamId, to: targetTeamId });
}
