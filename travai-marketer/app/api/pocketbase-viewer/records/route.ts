import { NextRequest, NextResponse } from 'next/server';
import { isPocketBaseViewerAuthenticated } from '@/lib/pocketbase-viewer-auth';
import { getPocketBaseViewerRecords } from '@/lib/pocketbase-viewer';

export async function GET(request: NextRequest) {
  if (!(await isPocketBaseViewerAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const collection = request.nextUrl.searchParams.get('collection') || '';
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || '1'));
  const perPage = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get('perPage') || '20'))
  );

  if (!collection) {
    return NextResponse.json(
      { error: 'Missing collection parameter' },
      { status: 400 }
    );
  }

  try {
    const payload = await getPocketBaseViewerRecords(collection, page, perPage);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[PocketBase Viewer Records] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load records' },
      { status: 500 }
    );
  }
}
