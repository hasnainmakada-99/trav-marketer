const DEFAULT_BASE_URL = 'https://traventions-ai.vercel.app';
const DEFAULT_FALLBACK_ROUTE = '/contact';
const DEFAULT_GOOGLE_REVIEW_URL =
  'https://www.google.com/search?q=Traventions+India+Pvt+Ltd+Reviews';

type StaticRoute = {
  route: string;
  label: string;
  redirectTo?: string;
};

type DynamicRoute = {
  routePattern: string;
  label: string;
  validSlugs?: string[];
  notes?: string;
};

type AuthRoute = {
  route: string;
  label: string;
};

type IntentMapping = {
  intent: string;
  keywords: string[];
  route?: string;
  routePattern?: string;
};

type RouteChoice = {
  path: string;
  url: string;
  label: string;
  loginRequired: boolean;
  source: 'intent_map' | 'website_knowledge' | 'fallback';
};

const PUBLIC_STATIC_ROUTES: StaticRoute[] = [
  { route: '/', label: 'Home' },
  { route: '/about', label: 'About Us' },
  { route: '/contact', label: 'Contact Us' },
  { route: '/services', label: 'All Services' },
  { route: '/packages', label: 'Holiday Packages' },
  { route: '/holidays/international', label: 'International Holidays' },
  { route: '/holidays/domestic', label: 'Domestic Holidays' },
  { route: '/airport-transfers', label: 'Airport Transfers' },
  { route: '/currency-calculator', label: 'Currency Calculator' },
  { route: '/insurance-calculator', label: 'Insurance Calculator' },
  { route: '/branch-locator', label: 'Branch Locator' },
  { route: '/careers', label: 'Careers' },
  { route: '/customer-support', label: 'Customer Support' },
  { route: '/escalation-channel', label: 'Escalation Channel' },
  { route: '/register-supplier', label: 'Register Supplier / DMC' },
  { route: '/sitemap', label: 'HTML Sitemap' },
  { route: '/terms', label: 'Terms' },
  { route: '/privacy', label: 'Privacy Policy' },
  { route: '/cancellation-policy', label: 'Cancellation Policy' },
  { route: '/refund-policy', label: 'Refund Policy' },
  { route: '/disclaimer', label: 'Disclaimer' },
  { route: '/payment-security', label: 'Payment Security' },
  { route: '/login', label: 'User Login' },
  { route: '/map', label: 'Trip Map' },
  { route: '/inspiration/v2', label: 'Inspiration Trips v2' },
  { route: '/inspiration', label: 'Redirects to /packages', redirectTo: '/packages' },
];

const PUBLIC_DYNAMIC_ROUTES: DynamicRoute[] = [
  {
    routePattern: '/services/[slug]',
    label: 'Service Detail',
    validSlugs: [
      'mice',
      'corporate-travel',
      'events-and-activations',
      'flights',
      'hotels',
      'holiday-packages',
      'honeymoon-packages',
      'visa',
      'travel-insurance',
    ],
  },
  {
    routePattern: '/holidays/international/[slug]',
    label: 'International Package Detail',
    notes: 'slug sourced from holiday packages where type=international',
  },
  {
    routePattern: '/holidays/domestic/[slug]',
    label: 'Domestic Package Detail',
    notes: 'slug sourced from holiday packages where type=domestic',
  },
  {
    routePattern: '/holidays/[destination]',
    label: 'Destination Hub Page',
    notes: 'supports destination aliases',
  },
  { routePattern: '/packages/[id]', label: 'Package Detail by ID' },
  { routePattern: '/inspiration/[id]', label: 'Inspiration Itinerary Detail' },
  { routePattern: '/itinerary/[id]', label: 'Itinerary Detail / Booking Flow' },
];

const AUTH_REQUIRED_ROUTES: AuthRoute[] = [
  { route: '/chat', label: 'Trav AI Planner' },
  { route: '/trips', label: 'My Trips' },
  { route: '/trips/[id]', label: 'Trip Detail' },
  { route: '/trips/join/[token]', label: 'Trip Collaboration Join' },
  { route: '/profile', label: 'User Profile' },
  { route: '/settings', label: 'User Settings' },
];

const SYSTEM_ROUTES_BLOCKED = new Set(['/auth/callback', '/api/sitemap.xml', '/robots.txt']);
const INTERNAL_TEST_ROUTES_BLOCKED = new Set(['/demo', '/demo/chat', '/test-websocket']);

const ADMIN_ROUTE_PREFIX = '/admin';

const INTENT_TO_ROUTE: IntentMapping[] = [
  { intent: 'plan_trip', keywords: ['plan', 'itinerary', 'travel plan', 'ai'], route: '/chat' },
  {
    intent: 'view_packages',
    keywords: ['packages', 'holiday deals', 'tour package'],
    route: '/packages',
  },
  {
    intent: 'international_holidays',
    keywords: ['international', 'abroad', 'overseas'],
    route: '/holidays/international',
  },
  {
    intent: 'domestic_holidays',
    keywords: ['domestic', 'india trip', 'within india'],
    route: '/holidays/domestic',
  },
  {
    intent: 'service_info',
    keywords: ['visa', 'insurance', 'corporate travel', 'mice', 'flights', 'hotels'],
    routePattern: '/services/[slug]',
  },
  { intent: 'customer_help', keywords: ['support', 'help', 'issue'], route: '/customer-support' },
  {
    intent: 'escalation',
    keywords: ['complaint', 'escalate', 'unresolved'],
    route: '/escalation-channel',
  },
  {
    intent: 'contact',
    keywords: ['contact', 'call', 'email', 'reach team'],
    route: '/contact',
  },
  { intent: 'legal_privacy', keywords: ['privacy', 'data policy'], route: '/privacy' },
  { intent: 'legal_terms', keywords: ['terms', 'conditions'], route: '/terms' },
  { intent: 'refunds', keywords: ['refund'], route: '/refund-policy' },
  { intent: 'cancellation', keywords: ['cancel', 'cancellation'], route: '/cancellation-policy' },
  {
    intent: 'payment_safety',
    keywords: ['payment safety', 'secure payment'],
    route: '/payment-security',
  },
  { intent: 'branch', keywords: ['office', 'branch', 'location'], route: '/branch-locator' },
  {
    intent: 'airport_transfer',
    keywords: ['airport transfer', 'cab', 'pickup'],
    route: '/airport-transfers',
  },
  {
    intent: 'currency',
    keywords: ['currency', 'exchange', 'conversion'],
    route: '/currency-calculator',
  },
  {
    intent: 'insurance_calc',
    keywords: ['travel insurance', 'premium'],
    route: '/insurance-calculator',
  },
];

function getBaseUrl() {
  return (process.env.TRAVENTIONS_WEBSITE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function normalizePath(pathOrUrl: string): string | null {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return null;

  try {
    const base = new URL(getBaseUrl());
    const parsed = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw, base.origin);
    if (parsed.origin !== base.origin) return null;
    let path = parsed.pathname || '/';
    path = path.replace(/\/+$/, '') || '/';
    return path;
  } catch {
    return null;
  }
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[[^\]]+\\\]/g, '[^/]+');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesAnyPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => patternToRegex(pattern).test(path));
}

function includesKeyword(messageLower: string, keyword: string) {
  const needle = keyword.toLowerCase().trim();
  if (!needle) return false;
  return messageLower.includes(needle);
}

function resolveServiceSlug(messageLower: string): string {
  if (includesKeyword(messageLower, 'visa')) return 'visa';
  if (includesKeyword(messageLower, 'insurance')) return 'travel-insurance';
  if (includesKeyword(messageLower, 'corporate')) return 'corporate-travel';
  if (includesKeyword(messageLower, 'mice')) return 'mice';
  if (includesKeyword(messageLower, 'events')) return 'events-and-activations';
  if (includesKeyword(messageLower, 'hotel')) return 'hotels';
  if (includesKeyword(messageLower, 'flight')) return 'flights';
  if (includesKeyword(messageLower, 'honeymoon')) return 'honeymoon-packages';
  return 'holiday-packages';
}

function isAuthRequiredPath(path: string): boolean {
  return matchesAnyPattern(
    path,
    AUTH_REQUIRED_ROUTES.map((r) => r.route)
  );
}

function isPublicStaticPath(path: string): boolean {
  return PUBLIC_STATIC_ROUTES.some((r) => r.route === path);
}

function isPublicDynamicPath(path: string): boolean {
  return matchesAnyPattern(
    path,
    PUBLIC_DYNAMIC_ROUTES.map((r) => r.routePattern)
  );
}

function toAbsoluteUrl(path: string) {
  return `${getBaseUrl()}${path}`;
}

function normalizeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.toString();
  } catch {
    return null;
  }
}

function getAllowedExternalUrls(): string[] {
  const envUrls = (process.env.WA_ALLOWED_EXTERNAL_URLS || '')
    .split(',')
    .map((v) => normalizeExternalUrl(v))
    .filter((v): v is string => Boolean(v));
  const reviewUrl = normalizeExternalUrl(process.env.WA_GOOGLE_REVIEW_URL || DEFAULT_GOOGLE_REVIEW_URL);
  return Array.from(new Set([reviewUrl, ...envUrls].filter((v): v is string => Boolean(v))));
}

function isAllowedExternalUrl(url: string): boolean {
  const candidate = normalizeExternalUrl(url);
  if (!candidate) return false;
  return getAllowedExternalUrls().some((allowed) => candidate === allowed);
}

export function isConfidentialOrBlockedRoutePath(pathOrUrl: string): boolean {
  const path = normalizePath(pathOrUrl);
  if (!path) return true;
  if (path === ADMIN_ROUTE_PREFIX || path.startsWith(`${ADMIN_ROUTE_PREFIX}/`)) return true;
  if (SYSTEM_ROUTES_BLOCKED.has(path)) return true;
  if (INTERNAL_TEST_ROUTES_BLOCKED.has(path)) return true;
  if (path.startsWith('/api/')) return true;
  return false;
}

export function isCustomerSafeRoutePath(pathOrUrl: string): boolean {
  const path = normalizePath(pathOrUrl);
  if (!path) return false;
  if (isConfidentialOrBlockedRoutePath(path)) return false;
  return isPublicStaticPath(path) || isPublicDynamicPath(path) || isAuthRequiredPath(path);
}

export function sanitizeWebsiteUrlForBot(url: string | null | undefined): string {
  const fallback = toAbsoluteUrl(DEFAULT_FALLBACK_ROUTE);
  if (!url) return fallback;
  const path = normalizePath(url);
  if (!path || !isCustomerSafeRoutePath(path)) return fallback;
  return toAbsoluteUrl(path);
}

export function sanitizeWebsiteSnippetsForBot(snippets: string[]): string[] {
  const out: string[] = [];
  for (const snippet of snippets) {
    const text = String(snippet || '').trim();
    if (!text) continue;
    const urlMatches = text.match(/https?:\/\/[^\s)]+/gi) || [];
    if (urlMatches.length === 0) {
      out.push(text);
      continue;
    }
    const hasBlocked = urlMatches.some((u) => isConfidentialOrBlockedRoutePath(u));
    if (!hasBlocked) {
      out.push(text);
    }
  }
  return out;
}

export function enforceSafeUrlsInReply(text: string): string {
  let output = String(text || '');
  const fallbackUrl = toAbsoluteUrl(DEFAULT_FALLBACK_ROUTE);

  output = output.replace(/https?:\/\/[^\s)]+/gi, (url) => {
    return isCustomerSafeRoutePath(url) || isAllowedExternalUrl(url) ? url : fallbackUrl;
  });

  output = output.replace(/(^|[\s(])\/[a-zA-Z0-9\-_/[\]]*/g, (full, prefix, pathToken: string) => {
    if (!pathToken || pathToken === '/') return full;
    if (isConfidentialOrBlockedRoutePath(pathToken)) {
      return `${prefix}${DEFAULT_FALLBACK_ROUTE}`;
    }
    return full;
  });

  return output;
}

export function resolveCustomerRouteFromMessage(message: string, classifiedIntent?: string): RouteChoice {
  const lower = String(message || '').toLowerCase();
  const intentHit = INTENT_TO_ROUTE.find((entry) => entry.keywords.some((kw) => includesKeyword(lower, kw)));

  if (intentHit?.route) {
    const path = intentHit.route;
    return {
      path,
      url: toAbsoluteUrl(path),
      label: intentHit.intent,
      loginRequired: isAuthRequiredPath(path),
      source: 'intent_map',
    };
  }

  if (intentHit?.routePattern === '/services/[slug]') {
    const slug = resolveServiceSlug(lower);
    const path = `/services/${slug}`;
    return {
      path,
      url: toAbsoluteUrl(path),
      label: `${intentHit.intent}:${slug}`,
      loginRequired: false,
      source: 'intent_map',
    };
  }

  const fallbackIntent = String(classifiedIntent || '').toLowerCase();
  if (fallbackIntent.includes('complaint') || fallbackIntent.includes('escalat')) {
    const path = '/escalation-channel';
    return {
      path,
      url: toAbsoluteUrl(path),
      label: 'escalation',
      loginRequired: false,
      source: 'intent_map',
    };
  }
  if (fallbackIntent.includes('booking') || fallbackIntent.includes('inquiry')) {
    const path = '/packages';
    return {
      path,
      url: toAbsoluteUrl(path),
      label: 'view_packages',
      loginRequired: false,
      source: 'intent_map',
    };
  }

  const path = DEFAULT_FALLBACK_ROUTE;
  return {
    path,
    url: toAbsoluteUrl(path),
    label: 'fallback_contact',
    loginRequired: false,
    source: 'fallback',
  };
}

export function resolveSafeRouteChoice(params: {
  message: string;
  classifiedIntent?: string;
  websiteUrlHint?: string | null;
}): RouteChoice {
  const byIntent = resolveCustomerRouteFromMessage(params.message, params.classifiedIntent);
  if (byIntent.source === 'intent_map') return byIntent;

  const hintedPath = normalizePath(params.websiteUrlHint || '');
  if (hintedPath && isCustomerSafeRoutePath(hintedPath)) {
    return {
      path: hintedPath,
      url: toAbsoluteUrl(hintedPath),
      label: 'website_hint',
      loginRequired: isAuthRequiredPath(hintedPath),
      source: 'website_knowledge',
    };
  }

  return byIntent;
}

export function getBotRoutePolicyPromptBlock() {
  const publicList = PUBLIC_STATIC_ROUTES.map((r) =>
    `${r.route}${r.redirectTo ? ` (redirects to ${r.redirectTo})` : ''}`
  ).join(', ');
  const dynamicList = PUBLIC_DYNAMIC_ROUTES.map((r) => r.routePattern).join(', ');
  const authList = AUTH_REQUIRED_ROUTES.map((r) => r.route).join(', ');

  return [
    'BOT ROUTE SAFETY POLICY:',
    `- You may only recommend routes from these public static paths: ${publicList}.`,
    `- You may also recommend these public dynamic patterns when relevant: ${dynamicList}.`,
    `- Auth-required paths are allowed only when needed, and must mention login required: ${authList}.`,
    '- Never share admin routes, internal/test routes, system callback routes, robots/sitemap API paths, or any /api/* route.',
    `- If unsure, direct customer to ${DEFAULT_FALLBACK_ROUTE}.`,
  ].join('\n');
}
