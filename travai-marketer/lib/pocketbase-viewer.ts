import { getPocketBaseAdmin, getPocketBaseSchema } from '@/lib/pocketbase-server';

type PocketBaseViewerCollection = {
  name: string;
  type: string;
  total: number;
};

const SENSITIVE_FIELD_REGEX =
  /(token|secret|password|api[_-]?key|refresh|verify)/i;

function redactValue(key: string, value: unknown) {
  if (value == null) return value;
  if (SENSITIVE_FIELD_REGEX.test(key)) {
    return '[redacted]';
  }
  return value;
}

function serializeValue(key: string, value: unknown) {
  const redacted = redactValue(key, value);
  if (redacted == null) return null;
  if (typeof redacted === 'string') {
    return redacted.length > 500 ? `${redacted.slice(0, 500)}...` : redacted;
  }
  if (
    typeof redacted === 'number' ||
    typeof redacted === 'boolean'
  ) {
    return redacted;
  }
  try {
    const text = JSON.stringify(redacted);
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return String(redacted);
  }
}

export async function listPocketBaseViewerCollections() {
  const pb = await getPocketBaseAdmin();
  const schema = getPocketBaseSchema();
  const collections: PocketBaseViewerCollection[] = [];

  for (const collection of schema) {
    const page = await pb.collection(collection.name).getList(1, 1);
    collections.push({
      name: collection.name,
      type: collection.type,
      total: page.totalItems,
    });
  }

  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPocketBaseViewerRecords(
  collectionName: string,
  page = 1,
  perPage = 20
) {
  const pb = await getPocketBaseAdmin();
  const schema = getPocketBaseSchema().find(
    (collection) => collection.name === collectionName
  );
  if (!schema) {
    throw new Error(`Unknown collection "${collectionName}"`);
  }

  const fields = schema.fields.map((field) => field.name);
  const pageResult = await pb.collection(collectionName).getList(page, perPage, {
    sort: schema.fields.some((field) => field.name === 'updatedAt')
      ? '-updatedAt'
      : schema.fields.some((field) => field.name === 'createdAt')
        ? '-createdAt'
        : undefined,
  });

  const records = pageResult.items.map((item) => {
    const source = item as Record<string, unknown>;
    const normalized: Record<string, unknown> = {
      id: source.id,
    };

    for (const field of fields) {
      normalized[field] = serializeValue(field, source[field]);
    }

    return normalized;
  });

  return {
    collection: collectionName,
    fields: ['id', ...fields],
    page: pageResult.page,
    perPage: pageResult.perPage,
    totalItems: pageResult.totalItems,
    totalPages: pageResult.totalPages,
    records,
  };
}
