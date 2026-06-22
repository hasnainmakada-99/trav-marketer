import { NextRequest, NextResponse } from 'next/server';
import {
  createPocketBaseViewerSession,
  validateViewerCredentials,
} from '@/lib/pocketbase-viewer-auth';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    if (
      !validateViewerCredentials(
        String(body.username || ''),
        String(body.password || '')
      )
    ) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    await createPocketBaseViewerSession();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PocketBase Viewer Login] Error:', error);
    return NextResponse.json(
      { error: 'Failed to sign in' },
      { status: 500 }
    );
  }
}
