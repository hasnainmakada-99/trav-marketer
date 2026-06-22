import { Query } from 'node-appwrite';
import { APPWRITE_DATABASE_ID, getDatabaseClient } from '@/lib/appwrite';
import { getActiveDataBackend } from '@/lib/data-backend';
import { getPocketBaseSchema, listPocketBaseDocuments } from '@/lib/pocketbase-server';
import { isConfidentialOrBlockedRoutePath, isCustomerSafeRoutePath } from '@/lib/whatsapp-bot-routing';

const WEBSITE_BASE_URL =
  process.env.TRAVENTIONS_WEBSITE_URL || 'https://traventions-ai.vercel.app';

const SECONDARY_DEFAULT_DATABASE_ID = '';

const PACKAGE_TERMS_REGEX =
  /\b(package|packages|itinerary|trip|tour|price|pricing|budget|offer|day|days|night|nights|inclusions|exclusions)\b/i;

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'have',
  'from',
  'your',
  'you',
  'are',
  'what',
  'when',
  'where',
  'which',
  'would',
  'could',
  'should',
  'about',
  'please',
  'need',
  'want',
  'help',
  'there',
  'their',
  'ours',
  'ourselves',
  'they',
  'them',
  'how',
  'can',
  'will',
  'into',
  'has',
  'had',
  'was',
  'were',
  'been',
  'any',
  'get',
  'give',
  'tell',
  'show',
  'more',
  'less',
  'very',
  'just',
  'only',
]);

const EXCLUDED_COLLECTIONS = new Set([
  'conversations',
  'customers',
  'campaign_logs',
  'staff',
]);

const PRIORITY_COLLECTIONS = [
  'business_configs',
  'campaigns',
  'gbp_posts',
  'gbp_reviews',
  'leads',
  'trips',
  'itineraries',
  'itinerary_days',
  'itinerary_activities',
  'itinerary_hotels',
  'featured_itineraries',
  'destinations',
  'bookings',
  'booking_requests',
  'promotions',
  'chat_response_templates',
  'hotel_options',
  'flight_options',
];

const KNOWLEDGE_COLLECTION_NAME_HINT =
  /(package|trip|itiner|destin|tour|holiday|booking|flight|hotel|promo|travel|visa|insurance|chat_response|support)/i;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type WebsitePage = {
  url: string;
  title: string;
  snippet: string;
};

type ScoredText = {
  text: string;
  score: number;
  hasPackageSignal: boolean;
};

type CollectionRef = {
  databaseId: string;
  collectionId: string;
};

type TravelKnowledge = {
  databaseSnippets: string[];
  hasPackageData: boolean;
  bestWebsiteUrl: string;
  bestWebsiteTitle: string;
  websiteSnippets: string[];
  diagnostics: {
    collectionsScanned: string[];
    collectionDocCounts: Record<string, number>;
    crawledPages: number;
  };
};

let collectionCache: CacheEntry<CollectionRef[]> | null = null;
let siteCache: CacheEntry<WebsitePage[]> | null = null;
let knowledgeQueryCache: CacheEntry<Map<string, TravelKnowledge>> | null = null;

function now() {
  return Date.now();
}

function toCache<T>(value: T, ttlMs: number): CacheEntry<T> {
  return { value, expiresAt: now() + ttlMs };
}

function fromCache<T>(entry: CacheEntry<T> | null): T | null {
  if (!entry) return null;
  if (entry.expiresAt < now()) return null;
  return entry.value;
}

export function extractKeywords(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(
    (word) => !STOPWORDS.has(word)
  );
  return Array.from(new Set(words)).slice(0, 16);
}

export function isPackageIntent(message: string, intent: string): boolean {
  if (intent === 'booking' || intent === 'inquiry') return true;
  return PACKAGE_TERMS_REGEX.test(message);
}

function scoreByKeywords(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 1;
  }
  return score;
}

async function resolveKnowledgeDatabaseIds() {
  const envDatabaseIds = (process.env.WA_KNOWLEDGE_DATABASE_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const secondaryDatabaseId = (process.env.WA_KNOWLEDGE_SECONDARY_DATABASE_ID || '').trim();
  const autoDiscoverDatabases =
    (process.env.WA_KNOWLEDGE_AUTO_DISCOVER_DBS || 'false').trim().toLowerCase() === 'true';
  const discovered: string[] = [];

  if (autoDiscoverDatabases) {
    try {
      const db = getDatabaseClient();
      const response = await db.list();
      for (const item of response.databases || []) {
        if (item?.$id) discovered.push(item.$id);
      }
    } catch {
      // best effort only
    }
  }

  return Array.from(
    new Set([
      APPWRITE_DATABASE_ID,
      SECONDARY_DEFAULT_DATABASE_ID,
      secondaryDatabaseId,
      ...envDatabaseIds,
      ...discovered,
    ])
  );
}

function shouldIncludeCollection(collectionId: string) {
  if (EXCLUDED_COLLECTIONS.has(collectionId)) return false;
  if (PRIORITY_COLLECTIONS.includes(collectionId)) return true;
  return KNOWLEDGE_COLLECTION_NAME_HINT.test(collectionId);
}

function normalizeUrl(url: string): string | null {
  try {
    const base = new URL(WEBSITE_BASE_URL);
    const parsed = new URL(url, base.origin);
    if (parsed.origin !== base.origin) return null;

    if (
      /\.(png|jpg|jpeg|gif|svg|webp|ico|pdf|xml|txt|woff|woff2|ttf|css|js)$/i.test(
        parsed.pathname
      )
    ) {
      return null;
    }
    if (isConfidentialOrBlockedRoutePath(parsed.pathname)) {
      return null;
    }
    if (!isCustomerSafeRoutePath(parsed.pathname)) {
      return null;
    }

    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinks(html: string): string[] {
  const links: string[] = [];
  const regex = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = regex.exec(html);
    if (!match) break;
    links.push(match[1]);
  }
  return links;
}

async function fetchPage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'trav-ai-marketer-knowledge-bot/1.0' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (titleMatch?.[1] || '').trim();
    const snippet = stripHtml(html).slice(0, 420);
    return { html, title, snippet };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function crawlWebsitePages(): Promise<WebsitePage[]> {
  const cached = fromCache(siteCache);
  if (cached) return cached;

  const start = normalizeUrl(WEBSITE_BASE_URL) || WEBSITE_BASE_URL;
  const queue = [start, `${start.replace(/\/$/, '')}/sitemap`];
  const visited = new Set<string>();
  const pages: WebsitePage[] = [];
  const maxPages = 8;

  const crawlDeadline = Date.now() + 12000;

  while (queue.length > 0 && pages.length < maxPages && Date.now() < crawlDeadline) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const page = await fetchPage(current);
    if (!page) continue;

    pages.push({
      url: current,
      title: page.title || 'Traventions',
      snippet: page.snippet,
    });

    const links = extractLinks(page.html);
    for (const raw of links) {
      const normalized = normalizeUrl(raw);
      if (!normalized || visited.has(normalized)) continue;
      queue.push(normalized);
    }
  }

  siteCache = toCache(pages, 15 * 60 * 1000);
  return pages;
}

async function resolveKnowledgeCollections(): Promise<CollectionRef[]> {
  const cached = fromCache(collectionCache);
  if (cached) return cached;

  if (getActiveDataBackend() === 'pocketbase') {
    const refs = getPocketBaseSchema()
      .map((collection) => collection.name)
      .filter((collectionId) => shouldIncludeCollection(collectionId))
      .map((collectionId) => ({
        databaseId: 'pocketbase',
        collectionId,
      }));
    collectionCache = toCache(refs, 60 * 60 * 1000);
    return refs;
  }

  const db = getDatabaseClient();
  const envCollections = (process.env.WA_KNOWLEDGE_COLLECTIONS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const refs: CollectionRef[] = [];

  const databaseIds = await resolveKnowledgeDatabaseIds();
  for (const databaseId of databaseIds) {
    try {
      const response = await db.listCollections(databaseId);
      const discovered = response.collections
        .map((c) => c.$id)
        .filter((id) => shouldIncludeCollection(id));

      const mergedForDb = Array.from(
        new Set([
          ...envCollections.filter((c) => discovered.includes(c)),
          ...PRIORITY_COLLECTIONS.filter((c) => discovered.includes(c)),
          ...discovered,
        ])
      );

      for (const collectionId of mergedForDb) {
        refs.push({ databaseId, collectionId });
      }
    } catch {
      // Skip inaccessible DB and continue.
    }
  }

  const deduped = Array.from(
    new Map(refs.map((r) => [`${r.databaseId}:${r.collectionId}`, r])).values()
  );
  collectionCache = toCache(deduped, 60 * 60 * 1000);
  return deduped;
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => stringifyValue(v)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function docToSearchText(databaseId: string, collectionId: string, doc: Record<string, unknown>) {
  const preferredKeys = [
    'title',
    'name',
    'packageName',
    'destination',
    'country',
    'city',
    'category',
    'duration',
    'days',
    'nights',
    'price',
    'budget',
    'inclusions',
    'exclusions',
    'highlights',
    'itinerary',
    'description',
    'content',
    'message',
    'notes',
    'summary',
    'tags',
  ];

  const ignoreKeys = new Set([
    '$id',
    '$databaseId',
    '$collectionId',
    '$permissions',
    '$createdAt',
    '$updatedAt',
    'teamId',
    'customerId',
    'metaMessageId',
    'createdAt',
    'updatedAt',
  ]);

  const chunks: string[] = [];
  for (const key of preferredKeys) {
    if (!(key in doc)) continue;
    const value = stringifyValue(doc[key]);
    if (value) chunks.push(`${key}: ${value}`);
  }

  if (chunks.length < 3) {
    for (const [key, value] of Object.entries(doc)) {
      if (ignoreKeys.has(key)) continue;
      const parsed = stringifyValue(value);
      if (!parsed || parsed.length < 3) continue;
      chunks.push(`${key}: ${parsed}`);
      if (chunks.length >= 10) break;
    }
  }

  if (!chunks.length) return '';
  return `[${databaseId}.${collectionId}] ${chunks.join(' | ')}`.slice(0, 1000);
}

async function fetchCollectionDocs(databaseId: string, collectionId: string, teamId: string) {
  const baseLimit = Number(process.env.WA_DB_DOC_LIMIT || '12');
  const limit = Number.isFinite(baseLimit) && baseLimit > 0 ? baseLimit : 80;

  if (getActiveDataBackend() === 'pocketbase') {
    try {
      const result = await listPocketBaseDocuments(collectionId, [
        Query.equal('teamId', teamId),
        Query.orderDesc('$createdAt'),
        Query.limit(limit),
      ]);
      return result.documents as Array<Record<string, unknown>>;
    } catch {
      try {
        const result = await listPocketBaseDocuments(collectionId, [
          Query.orderDesc('$createdAt'),
          Query.limit(limit),
        ]);
        return result.documents as Array<Record<string, unknown>>;
      } catch {
        try {
          const result = await listPocketBaseDocuments(collectionId, [Query.limit(limit)]);
          return result.documents as Array<Record<string, unknown>>;
        } catch {
          return [];
        }
      }
    }
  }

  const db = getDatabaseClient();

  try {
    const result = await db.listDocuments(databaseId, collectionId, [
      Query.equal('teamId', teamId),
      Query.orderDesc('$createdAt'),
      Query.limit(limit),
    ]);
    return result.documents as Array<Record<string, unknown>>;
  } catch {
    try {
      const result = await db.listDocuments(databaseId, collectionId, [
        Query.orderDesc('$createdAt'),
        Query.limit(limit),
      ]);
      return result.documents as Array<Record<string, unknown>>;
    } catch {
      try {
        const result = await db.listDocuments(databaseId, collectionId, [Query.limit(limit)]);
        return result.documents as Array<Record<string, unknown>>;
      } catch {
        return [];
      }
    }
  }
}

function scorePage(url: string, title: string, snippet: string, keywords: string[]) {
  const haystack = `${title} ${snippet} ${url}`.toLowerCase();
  let score = scoreByKeywords(haystack, keywords);
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (pathname.includes('/packages')) score += 4;
  if (pathname.includes('/holidays')) score += 3;
  if (pathname.includes('/chat')) score += 2;
  if (pathname.includes('/services/visa') && /\bvisa|immigration\b/i.test(haystack)) score += 4;
  if (
    pathname.includes('/services/travel-insurance') &&
    /\binsurance|cover|medical\b/i.test(haystack)
  ) {
    score += 4;
  }
  if (pathname.includes('/contact') && /\bcontact|support|help\b/i.test(haystack)) score += 3;
  if (pathname.includes('/customer-support') && /\bsupport|issue|complaint\b/i.test(haystack)) {
    score += 3;
  }
  if (pathname.includes('/currency-calculator') && /\bcurrency|forex|exchange\b/i.test(haystack)) {
    score += 4;
  }

  return score;
}

export function buildRuleBasedItinerary(userMessage: string) {
  const dayMatch = userMessage.match(/(\d+)\s*(day|days|night|nights)/i);
  const days = dayMatch ? Math.max(2, Math.min(10, Number(dayMatch[1]))) : 5;
  const destinationMatch = userMessage.match(
    /\bfor\s+([a-zA-Z\s]+?)(?:\s+for|\s+under|\s+within|$)/i
  );
  const destination = (destinationMatch?.[1] || 'your destination')
    .replace(/\s+/g, ' ')
    .trim();

  const lines = [
    `Welcome to Traventions! Here's a sample ${days}-day itinerary for ${destination}:`,
    `1. *Day 1:* Arrival, hotel check-in, local evening exploration.`,
    `2. *Day 2:* City highlights tour + key attractions.`,
    `3. *Day 3:* Culture and local experiences.`,
    `4. *Day 4:* Adventure/shopping + leisure.`,
    `5. *Day 5:* Flexible day and departure planning.`,
    `This is a quick sample. For exact live packages and prices, visit ${WEBSITE_BASE_URL.replace(/\/$/, '')}/packages.`,
  ];

  return lines.join('\n');
}

export async function loadTravelKnowledge(
  teamId: string,
  userMessage: string
): Promise<TravelKnowledge> {
  const cacheKey = `${teamId}::${userMessage.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  const cachedMap = fromCache(knowledgeQueryCache);
  const cached = cachedMap?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const keywords = extractKeywords(userMessage);
  const collections = await resolveKnowledgeCollections();
  const collectionDocCounts: Record<string, number> = {};
  const scoredDb: ScoredText[] = [];

  for (const ref of collections) {
    const key = `${ref.databaseId}.${ref.collectionId}`;
    const docs = await fetchCollectionDocs(ref.databaseId, ref.collectionId, teamId);
    collectionDocCounts[key] = docs.length;
    for (const doc of docs) {
      const text = docToSearchText(ref.databaseId, ref.collectionId, doc);
      if (!text) continue;
      const score = scoreByKeywords(text, keywords);
      const hasPackageSignal = PACKAGE_TERMS_REGEX.test(text);
      if (score <= 0 && !hasPackageSignal) continue;
      scoredDb.push({ text, score, hasPackageSignal });
    }
  }

  scoredDb.sort((a, b) => {
    if (b.hasPackageSignal !== a.hasPackageSignal) {
      return b.hasPackageSignal ? 1 : -1;
    }
    return b.score - a.score;
  });

  const uniqueDb = Array.from(new Map(scoredDb.map((item) => [item.text, item])).values());
  const dbTop = uniqueDb.slice(0, 12);
  const hasPackageData = dbTop.some((item) => item.hasPackageSignal);

  const websitePages = await crawlWebsitePages().catch(() => [] as WebsitePage[]);
  const scoredPages = websitePages
    .map((page) => ({
      page,
      score: scorePage(page.url, page.title, page.snippet, keywords),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scoredPages[0]?.page || {
    url: WEBSITE_BASE_URL,
    title: 'Traventions',
    snippet: 'Travel planning and packages',
  };

  const topWebsite = scoredPages
    .filter((entry) => entry.score > 0)
    .slice(0, 5)
    .map(
      (entry) =>
        `${entry.page.title} - ${entry.page.url} - ${entry.page.snippet.slice(0, 180)}`
    );

  const result: TravelKnowledge = {
    databaseSnippets: dbTop.map((item) => item.text),
    hasPackageData,
    bestWebsiteUrl: best.url,
    bestWebsiteTitle: best.title,
    websiteSnippets: topWebsite,
    diagnostics: {
      collectionsScanned: collections.map((c) => `${c.databaseId}.${c.collectionId}`),
      collectionDocCounts,
      crawledPages: websitePages.length,
    },
  };

  const nextCache = cachedMap || new Map<string, TravelKnowledge>();
  nextCache.set(cacheKey, result);
  knowledgeQueryCache = toCache(nextCache, 6 * 60 * 60 * 1000);

  return result;
}
