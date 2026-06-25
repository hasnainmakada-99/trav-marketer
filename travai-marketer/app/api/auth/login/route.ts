import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateDashboardUser,
  createDashboardSession,
} from '@/lib/dashboard-auth';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const user = await authenticateDashboardUser(
      String(body.email || ''),
      String(body.password || '')
    );

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid PocketBase admin credentials' },
        { status: 401 }
      );
    }

    await createDashboardSession(user);

    return NextResponse.json({ user });
  } catch (error) {
    console.error('[Dashboard Login] Error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
