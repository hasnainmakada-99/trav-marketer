import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments, createDocument } from '@/lib/appwrite';

export type StaffRole = 'owner' | 'admin' | 'manager' | 'staff';

function isInternalBootstrapUser(email?: string | null) {
  const normalized = (email || '').trim().toLowerCase();
  return normalized.endsWith('@travai.com') || normalized.endsWith('@traventions.com');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const email = searchParams.get('email');

    if (!userId && !email) {
      return NextResponse.json({ role: 'staff', found: false });
    }

    const queries = userId
      ? [Query.equal('userId', userId), Query.limit(1)]
      : [Query.equal('email', email!), Query.limit(1)];

    const result = await listDocuments('staff', queries).catch(() => ({ documents: [] }));

    if (result.documents.length > 0) {
      const doc = result.documents[0] as { role?: string; name?: string; email?: string; userId?: string };
      const resolvedEmail = doc.email || email;
      const resolvedRole = isInternalBootstrapUser(resolvedEmail) && (doc.role || 'staff') === 'staff'
        ? 'admin'
        : (doc.role || 'staff');
      return NextResponse.json({
        role: resolvedRole,
        name: doc.name,
        email: doc.email,
        found: true,
        bootstrap: resolvedRole !== (doc.role || 'staff'),
      });
    }

    if (isInternalBootstrapUser(email)) {
      return NextResponse.json({ role: 'admin', found: false, bootstrap: true });
    }

    return NextResponse.json({ role: 'staff', found: false });
  } catch (err) {
    console.error('[GET /api/staff/me]', err);
    return NextResponse.json({ role: 'staff', found: false });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      userId: string; email: string; name?: string; role: StaffRole; teamId?: string;
    };
    if (!body.userId || !body.email || !body.role) {
      return NextResponse.json({ error: 'userId, email and role are required' }, { status: 400 });
    }
    const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
    const now = new Date().toISOString();
    const doc = await createDocument('staff', {
      userId: body.userId,
      email: body.email,
      name: body.name || '',
      role: body.role,
      teamId: body.teamId || TEAM_ID,
      createdAt: now,
    });
    return NextResponse.json({ staff: doc }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/staff/me]', err);
    return NextResponse.json({ error: 'Failed to create staff record' }, { status: 500 });
  }
}
