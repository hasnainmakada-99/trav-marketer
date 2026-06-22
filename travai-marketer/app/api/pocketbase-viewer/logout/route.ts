import { NextResponse } from 'next/server';
import { clearPocketBaseViewerSession } from '@/lib/pocketbase-viewer-auth';

export async function POST() {
  await clearPocketBaseViewerSession();
  return NextResponse.json({ success: true });
}
