import { NextRequest, NextResponse } from 'next/server';

const PB_URL = (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const PB_EMAIL = (process.env.POCKETBASE_SUPERUSER_EMAIL || '').trim();
const PB_PASSWORD = (process.env.POCKETBASE_SUPERUSER_PASSWORD || '').trim();

let adminToken: string | null = null;
let tokenExpiry = 0;

async function getAdminToken(): Promise<string> {
  const now = Date.now();
  if (adminToken && Date.now() < tokenExpiry) return adminToken;

  const res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Admin auth failed: ${res.status}`);
  const data = await res.json();
  adminToken = data.token;
  tokenExpiry = Date.now() + 55 * 60 * 1000;
  return adminToken;
}

async function findLeadByIdOrPhone(id: string): Promise<{ id: string } | null> {
  const token = await getAdminToken();
  if (/^[a-z0-9]{15}$/i.test(id)) {
    const res = await fetch(`${PB_URL}/api/collections/leads/records/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { id } as any;
  }
  const searchRes = await fetch(
    `${PB_URL}/api/collections/leads/records?filter=(id="${id}"||appwriteId="${id}")&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.items?.length) return data.items[0];
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, human_takeover, taken_over_by } = body;

    if (!id || typeof human_takeover !== 'boolean') {
      return NextResponse.json(
        { error: 'id and human_takeover (boolean) required' },
        { status: 400 }
      );
    }

    const lead = await findLeadByIdOrPhone(id);
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const token = await getAdminToken();
    const updateData = {
      human_takeover,
      updatedAt: new Date().toISOString(),
      ...(taken_over_by ? { taken_over_by, taken_over_at: new Date().toISOString() } : {}),
    };

    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/collections/leads/records/${lead.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        human_takeover,
        updatedAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PocketBase update failed: ${res.status} ${err}`);
    }

    const updated = await res.json();
    return NextResponse.json({ success: true, lead: updated });
  } catch (error) {
    console.error('[Lead Takeover] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update lead takeover status' },
      { status: 500 }
    );
  }
}