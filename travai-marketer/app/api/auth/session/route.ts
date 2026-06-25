import { NextResponse } from 'next/server';
import { getDashboardSessionUser } from '@/lib/dashboard-auth';

export async function GET() {
  const user = await getDashboardSessionUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user,
  });
}
