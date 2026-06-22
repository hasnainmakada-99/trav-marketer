export type DataBackend = 'appwrite' | 'pocketbase';

function normalizeBackend(value: string | null | undefined, fallback: DataBackend): DataBackend {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === 'pocketbase' ? 'pocketbase' : fallback;
}

export function getActiveDataBackend(): DataBackend {
  return normalizeBackend(process.env.APP_DATA_BACKEND, 'appwrite');
}

export function getActiveStorageBackend(): DataBackend {
  return normalizeBackend(process.env.APP_STORAGE_BACKEND, getActiveDataBackend());
}

export function shouldMirrorWritesToPocketBase(): boolean {
  return process.env.POCKETBASE_MIRROR_WRITES === 'true';
}

export function isPocketBasePrimary(): boolean {
  return getActiveDataBackend() === 'pocketbase';
}
