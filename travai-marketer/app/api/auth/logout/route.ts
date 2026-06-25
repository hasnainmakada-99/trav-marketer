import { NextResponse } from 'next/server';
import { clearDashboardSession } from '@/lib/dashboard-auth';

export async function POST() {
  await clearDashboardSession();
  return NextResponse.json({ success: true });
}
