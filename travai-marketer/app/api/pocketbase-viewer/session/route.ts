import { NextResponse } from 'next/server';
import {
  getPocketBaseViewerUsername,
  isPocketBaseViewerAuthenticated,
} from '@/lib/pocketbase-viewer-auth';

export async function GET() {
  const authenticated = await isPocketBaseViewerAuthenticated();
  return NextResponse.json({
    authenticated,
    username: authenticated ? getPocketBaseViewerUsername() : null,
  });
}
