import { NextResponse } from 'next/server';

/**
 * GET /api/leads/debug
 * Returns raw diagnostic info to surface why leads are not showing.
 */
export async function GET() {
  return NextResponse.json({
    backend: 'pocketbase',
    message: 'Debug route is active — PocketBackend is the sole backend.',
  });
}
