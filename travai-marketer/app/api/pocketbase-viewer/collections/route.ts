import { NextResponse } from 'next/server';
import { isPocketBaseViewerAuthenticated } from '@/lib/pocketbase-viewer-auth';
import { listPocketBaseViewerCollections } from '@/lib/pocketbase-viewer';

export async function GET() {
  if (!(await isPocketBaseViewerAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const collections = await listPocketBaseViewerCollections();
    return NextResponse.json({ collections });
  } catch (error) {
    console.error('[PocketBase Viewer Collections] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load collections' },
      { status: 500 }
    );
  }
}
