import { NextRequest, NextResponse } from 'next/server';

function getPocketBaseUrl() {
  return (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
}

export async function GET(
  request: NextRequest,
  context: {
    params:
      | Promise<{ collectionId: string; recordId: string; filename: string }>
      | { collectionId: string; recordId: string; filename: string };
  }
) {
  try {
    const params = await Promise.resolve(context.params);
    const collectionId = decodeURIComponent(params.collectionId || '');
    const recordId = decodeURIComponent(params.recordId || '');
    const fileName = decodeURIComponent(params.filename || '');

    if (!collectionId || !recordId || !fileName) {
      return NextResponse.json({ error: 'Missing media path' }, { status: 400 });
    }

    const targetUrl = new URL(
      `${getPocketBaseUrl()}/api/files/${encodeURIComponent(collectionId)}/${encodeURIComponent(recordId)}/${encodeURIComponent(fileName)}`
    );
    const thumb = request.nextUrl.searchParams.get('thumb');
    const token = request.nextUrl.searchParams.get('token');
    if (thumb) targetUrl.searchParams.set('thumb', thumb);
    if (token) targetUrl.searchParams.set('token', token);

    const response = await fetch(targetUrl.toString(), {
      headers: {
        accept: request.headers.get('accept') || '*/*',
      },
      cache: 'force-cache',
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'File not found' }, { status: response.status });
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': response.headers.get('cache-control') || 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('[PocketBase Media Proxy] Error:', error);
    return NextResponse.json({ error: 'Failed to load media' }, { status: 500 });
  }
}
