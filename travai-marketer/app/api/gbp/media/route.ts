import { NextRequest, NextResponse } from 'next/server';
import { ID } from 'node-appwrite';
import {
  getPublicFileViewUrl,
  getStorageClient,
  STORAGE_BUCKETS,
} from '@/lib/appwrite';

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

    const storage = getStorageClient();
    const uploaded = [];

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

      const fileId = ID.unique();
      await storage.createFile(
        STORAGE_BUCKETS.GBP_MEDIA,
        fileId,
        file
      );

      uploaded.push({
        fileId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        teamId,
        mediaFormat: file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO',
        publicUrl: getPublicFileViewUrl(STORAGE_BUCKETS.GBP_MEDIA, fileId),
      });
    }

    return NextResponse.json({ files: uploaded }, { status: 201 });
  } catch (error) {
    console.error('[GBP Media Upload] Error:', error);
    return NextResponse.json(
      { error: 'Failed to upload GBP media' },
      { status: 500 }
    );
  }
}
