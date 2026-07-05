import { NextRequest, NextResponse } from 'next/server';
import { uploadPocketBaseMediaFiles } from '@/lib/pocketbase-server';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const teamId = formData.get('teamId');
    const rawFiles = formData.getAll('files');

    if (!teamId || typeof teamId !== 'string') {
      return NextResponse.json({ error: 'Missing teamId' }, { status: 400 });
    }

    const files = rawFiles.filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
    }

    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        return NextResponse.json(
          { error: `Unsupported file type: ${file.type || file.name}` },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `${file.name} is larger than 25MB` },
          { status: 400 }
        );
      }
    }

    const uploaded = await uploadPocketBaseMediaFiles(teamId, files);
    return NextResponse.json({ files: uploaded }, { status: 201 });
  } catch (error) {
    console.error('[GBP Media Upload] Error:', error);
    return NextResponse.json(
      { error: 'Failed to upload GBP media' },
      { status: 500 }
    );
  }
}
