import { destinationBudgetHint } from '@/lib/travel-data';

export type WorkflowIntent =
  | 'plan_holiday'
  | 'flights'
  | 'hotels'
  | 'transfer'
  | 'forex'
  | 'visa'
  | 'insurance'
  | 'mice'
  | 'booking_status'
  | 'callback_request'   // NEW: standalone "arrange callback" / "call me" requests
  | 'unknown';

export type WorkflowStage =
  | 'ask_destination'
  | 'ask_holiday_type'
  | 'ask_travel_details'
  | 'show_packages'          // deterministic (exclusive) or AI (personalized)
  | 'collect_lead'           // ask name + phone
  | 'ask_callback'           // ask preferred callback time
  | 'confirmed'              // all done â€” save lead to CRM
  | 'unknown';

export const PRIMARY_QUICK_MENU_OPTIONS = [
  'Plan a Holiday',
  'Flights',
  'Hotels',
] as const;

export const BROCHURE_URLS: Record<string, string> = {
  'holiday_packages': 'https://traventions.com/brochures/holiday-packages.pdf',
  'flight_bookings': 'https://traventions.com/brochures/flights.pdf',
  'hotel_bookings': 'https://traventions.com/brochures/hotels.pdf',
  'general': 'https://traventions.com/brochures/general.pdf',
};

export type WorkflowSlotMap = Partial<
  Record<
    | 'destination'
    | 'from_city'
    | 'to_city'
    | 'travel_time'
    | 'travellers'
    | 'departure_city'
    | 'nights'
    | 'checkin'
    | 'checkout'
    | 'budget_inr'
    | 'name'
    | 'phone'
    | 'email'
    | 'callback_time'
    | 'holiday_type'          // 'exclusive' | 'personalized'
    | 'hotel_preference'      // '3 star' | '4 star' | '5 star'
    | 'post_package_action',  // 'get_details' | 'get_itinerary' | 'customize' | 'arrange_callback'
    string
  >
>;

export type WorkflowState = {
  intent: WorkflowIntent;
  stage: WorkflowStage;
  source: 'locked_history' | 'selected_now' | 'detected_now';
  slots: WorkflowSlotMap;
  missingSlots: string[];
  complete: boolean;
  leadShouldBeSaved: boolean;
};

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalize(input: string) {
  return String(input || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeSelectionText(input: string) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text: string, words: string[]) {
  return words.some((w) => text.includes(w));
}

function pick(regex: RegExp, text: string): string | null {
  const m = text.match(regex);
  if (!m?.[1]) return null;
  return m[1].trim();
}

// â”€â”€â”€ fuzzy / typo matching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Levenshtein edit distance between two strings (optimised 1-row version)
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const curr =
        a[i - 1] === b[j - 1]
          ? row[j - 1]
          : 1 + Math.min(row[j], prev, row[j - 1]);
      row[j - 1] = prev;
      prev = curr;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

// Max edit-distance allowed for a keyword based on its length
function maxDist(keyword: string): number {
  const len = keyword.length;
  if (len <= 3) return 0;   // short words: exact
  if (len <= 5) return 1;   // medium: 1 typo
  return 2;                  // long: up to 2 typos
}

// Returns true if any whitespace-separated word in `text` is within
// edit-distance of `keyword`, or if `text` contains `keyword` as a substring.
function fuzzyWord(text: string, keyword: string): boolean {
  if (text.includes(keyword)) return true;
  const dist = maxDist(keyword);
  if (dist === 0) return false;
  return text.split(/[\s,]+/).some(
    (w) => Math.abs(w.length - keyword.length) <= dist && levenshtein(w, keyword) <= dist
  );
}

// Returns true when text fuzzy-matches any of the supplied keywords
function fuzzyAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => fuzzyWord(text, kw));
}

// Corrects common single-word typos and returns a cleaned version of the text
// so downstream keyword detection benefits automatically
function autoCorrect(text: string): string {
  const corrections: Record<string, string> = {
    // holidays / plans
    holday: 'holiday', holiay: 'holiday', holidya: 'holiday', holidy: 'holiday',
    hoiday: 'holiday', holiyday: 'holiday',
    // flights
    fligths: 'flights', fligts: 'flights', flighst: 'flights', flites: 'flights',
    flghts: 'flights', fligh: 'flight',
    // hotels
    hotles: 'hotels', hetols: 'hotels', hotles2: 'hotels',
    // exclusive
    exlcusive: 'exclusive', exclusvie: 'exclusive', exculsive: 'exclusive',
    exclsuive: 'exclusive', exlusice: 'exclusive', exclisive: 'exclusive',
    exclsuive2: 'exclusive',
    // personalized
    persomalized: 'personalized', personalzied: 'personalized',
    personilized: 'personalized', peronalized: 'personalized',
    persanalised: 'personalized', personalised: 'personalized',
    // details / package
    detials: 'details', detils: 'details', pakage: 'package', pacakge: 'package',
    packge: 'package', deatils: 'details',
    // itinerary
    itineray: 'itinerary', itinarary: 'itinerary', itinarery: 'itinerary',
    // callback
    callbck: 'callback', calback: 'callback', calbak: 'callback',
    // customize
    custmize: 'customize', cusomize: 'customize', custumize: 'customize',
    // arrange
    arange: 'arrange', arrang: 'arrange',
    // visa / transfer / forex
    tranfer: 'transfer', transfar: 'transfer', trasnfer: 'transfer',
    vsisa: 'visa', visaa: 'visa',
    forx: 'forex', froex: 'forex',
    // call me variants
    'cal me': 'call me', 'call me': 'call me',
  };

  return text
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      return corrections[lower] !== undefined
        ? word.replace(new RegExp(word, 'i'), corrections[lower])
        : word;
    })
    .join(' ');
}

function isGreetingLike(msg: string): boolean {
  // Match any message that starts with a greeting word (including help requests
  // like "Hi I need help..." or "Hello I want to book...").
  const stripped = String(msg || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)\b/i.test(
    stripped
  );
}

function detectHolidayType(raw: string): string | null {
  const text = normalize(autoCorrect(raw));
  // Personalized check first (more specific)
  if (
    fuzzyAny(text, ['personalized', 'personalised', 'personalise', 'customize', 'customise', 'custom']) ||
    hasAny(text, ['personalized holidays', 'personalized holiday', 'customize holiday', 'custom holiday'])
  ) {
    return 'personalized';
  }
  if (fuzzyAny(text, ['exclusive'])) {
    return 'exclusive';
  }
  return null;
}

function detectPostPackageAction(raw: string): string | null {
  const text = normalize(autoCorrect(raw));
  if (
    fuzzyAny(text, ['package details', 'get details']) ||
    hasAny(text, ['package detail', 'get package'])
  ) return 'get_details';
  if (
    fuzzyAny(text, ['itinerary']) ||
    hasAny(text, ['day wise', 'day-wise', 'daywise', 'get day'])
  ) return 'get_itinerary';
  if (hasAny(text, ['select an option', 'select option', '1ï¸âƒ£', '2ï¸âƒ£', '3ï¸âƒ£'])) return 'get_details';
  if (
    fuzzyAny(text, ['modify', 'customize', 'customise']) ||
    hasAny(text, ['edit plan', 'change plan'])
  ) return 'customize';
  if (
    fuzzyAny(text, ['callback', 'arrange']) &&
    (text.includes('arrange') || text.includes('callback'))
  ) return 'arrange_callback';
  return null;
}

function parseCallbackTime(raw: string): string | null {
  const corrected = autoCorrect(raw);

  // Pattern 1: Keyword-prefixed time ("callback at 5pm tomorrow", "call me tomorrow at 3pm")
  const explicit = pick(
    /\b(?:callback|call me|call back|preferred time|available at|prefer|anytime|any time)\s*[:\-]?\s*([a-zA-Z0-9 :/-]{3,40})/i,
    corrected
  );
  if (explicit) return explicit;

  // Pattern 2: Time + day combined ("5pm tomorrow", "5 PM on Saturday", "10:30 AM on monday")
  const timeThenDay = corrected.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+on\s+(?:today|tomorrow|tonight|this\s+(?:morning|afternoon|evening|week|weekend)|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i
  );
  if (timeThenDay) return timeThenDay[1].trim();
  const timeThenBareDay = corrected.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i
  );
  if (timeThenBareDay) return timeThenBareDay[1].trim();

  // Pattern 3: Just a time ("5 PM", "10:30 AM", "5pm")
  const justTime = corrected.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (justTime) return justTime[1].trim();

  // Pattern 4: Day + optional time ("Today at 5 PM", "Tomorrow morning", "Saturday afternoon")
  const timeExpr = corrected.match(
    /\b(today|tomorrow|tonight|this\s+(?:morning|afternoon|evening|week|weekend)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+[\d:]+\s*(?:am|pm)?|\s+(?:morning|afternoon|evening|night|noon))?\b/i
  );
  if (timeExpr) return timeExpr[0].trim();

  // Pattern 5: "anytime", "asap"
  if (/\b(anytime|any time|convenient|whenever)\b/i.test(corrected)) return 'at your convenience';
  if (/\b(asap|earliest)\b/i.test(corrected)) return 'at the earliest convenient time';

  return null;
}

function parseHotelPreference(raw: string): string | null {
  const text = normalize(raw);
  if (/\b5\s*star\b/.test(text) || text.includes('five star')) return '5 star';
  if (/\b4\s*star\b/.test(text) || text.includes('four star')) return '4 star';
  if (/\b3\s*star\b/.test(text) || text.includes('three star')) return '3 star';
  return null;
}

// Words that must NOT be treated as city names (bot menu text, service names, etc.)
const NON_CITY_WORDS = new Set([
  'forex', 'visa', 'insurance', 'transfer', 'mice', 'flight', 'flights',
  'hotel', 'hotels', 'holiday', 'holidays', 'booking', 'status', 'or', 'and',
  'the', 'type', 'service', 'plan', 'package', 'packages', 'exclusive',
  'personalized', 'personalised', 'itinerary', 'traventions', 'details',
  'sini', 'example', 'callback', 'contact', 'arrange', 'book', 'confirm',
  'yes', 'no', 'okay', 'ok', 'sure', 'thanks', 'thank', 'please', 'help',
  'support', 'speak', 'human', 'agent', 'team', 'name', 'number', 'phone',
]);

const CALLBACK_PHRASES = [
  'arrange callback', 'arrange a callback', 'arrange call back',
  'call me back', 'call back', 'callback', 'speak to support',
  'customer support', 'speak to human', 'speak to agent', 'speak to team',
  'contact support', 'talk to human', 'talk to agent', 'need help',
  'i want to speak', 'want callback', 'want a callback', 'need callback',
];

function normalizeTravellerValue(input: string): string {
  return String(input || '')
    .trim()
    .replace(/\bwomens?\b/gi, 'women')
    .replace(/\blad(?:y|ies)\b/gi, 'ladies')
    .replace(/\bmens?\b/gi, 'men')
    .replace(/\bguests?\b/gi, 'guests')
    .replace(/\s+/g, ' ');
}

// Try to parse comma-separated inputs:
// Travel: "2 Adults, July, Bangalore, 5 Nights"
// Lead:   "Sini, +91 9876543210, sini@gmail.com"
function tryParseCommaFormat(raw: string, intent: WorkflowIntent, existingSlots: WorkflowSlotMap): WorkflowSlotMap {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return {};

  const slots: WorkflowSlotMap = {};
  const monthRx = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(\s+\d{4})?$/i;
  const nightsRx = /^(\d+)\s*nights?$/i;
  const travellersRx = /^(\d+)\s*(adults?|children|kids?|pax|persons?|people|guests?|lad(?:y|ies)|wom[ae]n|womens?|m[ae]n|couples?)/i;
  const dateRx = /\d{1,2}(?:st|nd|rd|th)?\s+\w+|\w+\s+\d{1,2}(?:st|nd|rd|th)?/i;
  const hotelRx = /\d\s*star\s*(hotel)?|luxury|premium/i;
  const emailRx = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  const phoneRx = /^\+?\d[\d\s-]{6,14}\d$/;

  // Detect parts that contain a month name (in any position, e.g. "june mid", "mid-June")
  const containsMonthRx = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i;

  const travellersAccum: string[] = [];
  const unclassified: string[] = [];

  for (const part of parts) {
    const lp = normalize(part);
    if (emailRx.test(lp)) {
      if (!slots.email) slots.email = part.trim().toLowerCase();
    } else if (phoneRx.test(part.trim())) {
      if (!slots.phone) slots.phone = part.trim().replace(/\s+/g, '');
    } else if (monthRx.test(lp) || (containsMonthRx.test(part) && /^[a-zA-Z\s-]+$/.test(part))) {
      // Captures "june", "june mid", "mid-June", "early July" etc.
      if (!slots.travel_time) slots.travel_time = part;
    } else if (nightsRx.test(lp)) {
      const m = lp.match(/^(\d+)/);
      if (m) slots.nights = m[1];
    } else if (travellersRx.test(lp)) {
      travellersAccum.push(normalizeTravellerValue(part));
    } else if (hotelRx.test(lp)) {
      slots.hotel_preference = lp.replace(/\s*hotels?\s*/g, '').trim();
    } else if (!slots.travel_time && dateRx.test(part) && /\d/.test(part)) {
      slots.travel_time = part;
    } else if (/^\d+$/.test(part.trim()) && !travellersAccum.length && !slots.travellers) {
      // Standalone digit (e.g. "2") â€” treat as traveller count
      travellersAccum.push(part.trim());
    } else {
      unclassified.push(part);
    }
  }

  if (travellersAccum.length > 0) {
    slots.travellers = travellersAccum.join(', ');
  }

  // If email or phone were extracted, treat a short alpha unclassified part as the name
  if ((slots.email || slots.phone) && !existingSlots.name) {
    const namePart = unclassified.find(
      (p) => /^[a-zA-Z .'-]{2,40}$/.test(p) && !NON_CITY_WORDS.has(normalize(p))
    );
    if (namePart) slots.name = namePart;
  }

  // Remaining unclassified strings may be city names â€” apply blocklist
  const safeCityPart = (candidate: string) => {
    const key = normalize(candidate).trim();
    // Exclude parts that contain a month name â€” those are travel dates, not cities
    if (containsMonthRx.test(candidate)) return false;
    if (/\d/.test(candidate)) return false;
    return /^[a-zA-Z\s.'-]{2,30}$/.test(candidate) && !NON_CITY_WORDS.has(key);
  };

  const cities = unclassified.filter(safeCityPart);
  if (intent === 'plan_holiday') {
    if (existingSlots.destination) {
      // In travel-details step, a single city usually means departure city.
      if (!existingSlots.departure_city && cities[0]) slots.departure_city = cities[0];
    } else if (!existingSlots.destination && cities[0]) {
      slots.destination = cities[0];
      if (!existingSlots.departure_city && cities[1]) slots.departure_city = cities[1];
    }
  }
  if (intent === 'hotels') {
    if (!existingSlots.destination && cities[0]) slots.destination = cities[0];
  }
  if (intent === 'flights') {
    if (!existingSlots.from_city && cities[0]) slots.from_city = cities[0];
    if (!existingSlots.to_city && cities[1]) slots.to_city = cities[1];
  }

  return slots;
}

function parseGeneralSlots(
  message: string,
  intent: WorkflowIntent = 'unknown',
  knownSlots: WorkflowSlotMap = {}
): WorkflowSlotMap {
  const raw = autoCorrect(String(message || '').trim()); // fix typos first
  const text = normalize(raw);
  const slots: WorkflowSlotMap = {};

  // New slot types
  const ht = detectHolidayType(raw);
  if (ht) slots.holiday_type = ht;

  const hp = parseHotelPreference(raw);
  if (hp) slots.hotel_preference = hp;

  const ppa = detectPostPackageAction(raw);
  if (ppa) slots.post_package_action = ppa;

  // from â†’ to for flights
  const fromTo = raw.match(/\bfrom\s+([a-zA-Z .'-]+?)\s+to\s+([a-zA-Z .'-]+?)(?:\s|,|$)/i);
  if (fromTo?.[1] && fromTo?.[2]) {
    slots.from_city = fromTo[1].trim();
    slots.to_city = fromTo[2].trim();
  } else {
    // Common compact route input: "Delhi to Mumbai, 25th June, 2 Adults"
    const compactFromTo = raw.match(
      /(?:^|,|\broute\b\s*[:\-]?\s*)([a-zA-Z][a-zA-Z .'-]{1,28})\s+to\s+([a-zA-Z][a-zA-Z .'-]{1,28})(?=,|$|\s+\d)/i
    );
    if (compactFromTo?.[1] && compactFromTo?.[2]) {
      slots.from_city = compactFromTo[1].trim();
      slots.to_city = compactFromTo[2].trim();
    }
  }

  if (!slots.destination) {
    // Require colon/dash after "destination" to avoid capturing question phrases
    const destination = pick(
      /\b(?:going to|visit|trip to|holiday to|for hotels in|destination\s*[:\-])\s*([a-zA-Z .'-]{2,40})/i,
      raw
    );
    if (destination) slots.destination = destination;
  }
  if (!slots.destination && slots.to_city) {
    slots.destination = slots.to_city;
  }

  // Short standalone response (1-3 alpha words) is likely a destination when in plan_holiday or hotels context
  if ((intent === 'plan_holiday' || intent === 'hotels') && !slots.destination) {
    const words = raw.trim().split(/\s+/);
    const isShortAlpha = words.length <= 3 && words.every((w) => /^[a-zA-Z.'-]+$/.test(w));
    const NOT_DESTINATIONS = new Set([
      'plan a holiday', 'plan holiday', 'flights', 'hotels', 'exclusive', 'personalized',
      'personalised', 'yes', 'no', 'ok', 'okay', 'hi', 'hello', 'hey',
    ]);
    const hasTravelSlots =
      Boolean(slots.travellers) || Boolean(slots.travel_time) ||
      Boolean(slots.departure_city) || Boolean(slots.nights);
    const normalizedRaw = normalize(raw);
    const looksLikeCallback =
      Boolean(slots.post_package_action) ||
      CALLBACK_PHRASES.some((p) => normalizedRaw.includes(p)) ||
      /\b(callback|call me|call back|arrange|support|speak to|contact us|speak to human|help me)\b/i.test(raw);
    if (isShortAlpha && !hasTravelSlots && !looksLikeCallback && !NOT_DESTINATIONS.has(normalizedRaw)) {
      slots.destination = raw.trim();
    }
  }

  // Month/date extraction â€” keyword-prefixed
  const travelTime = pick(
    /\b(?:travel month|travel date|travel dates|date|on|in)\s*[:\-]?\s*([a-zA-Z0-9 ,/-]{3,40})/i,
    raw
  );
  if (travelTime) slots.travel_time = travelTime;

  // Month/date extraction â€” standalone (e.g. "july", "10th July")
  if (!slots.travel_time) {
    const monthMatch = raw.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:\s+\d{4})?\b/i
    );
    if (monthMatch) slots.travel_time = monthMatch[0].trim();
  }
  if (!slots.travel_time) {
    const dateMatch = raw.match(
      /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?)\b/i
    );
    if (dateMatch) slots.travel_time = dateMatch[0].trim();
  }

  // Travellers
  const travFull = raw.match(
    /\b(\d+\s*(?:adults?|children|kids?|child|pax|persons?|people|guests?|lad(?:y|ies)|wom[ae]n|womens?|m[ae]n)(?:\s*,?\s*(?:and\s+)?\d+\s*(?:children|kids?|child))?)\b/i
  );
  if (travFull) {
    slots.travellers = normalizeTravellerValue(travFull[1]);
  } else {
    const travellers = pick(
      /\b(?:travellers|travelers|traveller count|pax|passengers|guests?)\s*[:\-]?\s*([a-zA-Z0-9 ,/+]{1,30})/i,
      raw
    );
    if (travellers) slots.travellers = normalizeTravellerValue(travellers);
    else {
      const pax = pick(/\b(\d+)\s*(?:pax|passengers?|adults?|people|guests?|lad(?:y|ies)|wom[ae]n|womens?|m[ae]n|couples?)\b/i, raw);
      if (pax) slots.travellers = normalizeTravellerValue(pax);
    }
  }

  const departure = pick(
    /\b(?:departure city|departing from|from city)\s*[:\-]?\s*([a-zA-Z .'-]{2,40})/i,
    raw
  );
  if (departure) slots.departure_city = departure;
  if (!slots.departure_city && slots.from_city) {
    slots.departure_city = slots.from_city;
  }
  // "from [city]" pattern â€” catches "from Ahmedabad", "from Delhi" in holiday/hotel context
  if (!slots.departure_city && (intent === 'plan_holiday' || intent === 'hotels')) {
    const fromM = raw.match(/\bfrom\s+([a-zA-Z][a-zA-Z .'-]{1,28})(?=[\s,]|$)/i);
    if (fromM) {
      const candidate = fromM[1].trim();
      const key = normalize(candidate);
      const hasMonth = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(candidate);
      if (!hasMonth && !NON_CITY_WORDS.has(key) && !/\d/.test(candidate)) {
        slots.departure_city = candidate;
      }
    }
  }

  const nights = pick(/\b(\d+)\s*(?:nights?|night stay)\b/i, raw);
  if (nights) slots.nights = nights;

  const checkIn = pick(/\b(?:check[\s-]?in)\s*[:\-]?\s*([a-zA-Z0-9 ,/-]{3,30})/i, raw);
  const checkOut = pick(/\b(?:check[\s-]?out)\s*[:\-]?\s*([a-zA-Z0-9 ,/-]{3,30})/i, raw);
  if (checkIn) slots.checkin = checkIn;
  if (checkOut) slots.checkout = checkOut;

  const budget = pick(
    /\b(?:budget|approx budget)\s*[:\-]?\s*(?:â‚¹|inr)?\s*([0-9., ]+\s*[kKmM]?)\b/i,
    raw
  );
  if (budget) slots.budget_inr = budget.toUpperCase().replace(/\s+/g, ' ');

  const email = pick(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i, text);
  if (email) slots.email = email;

  const phone = pick(/\b(\+?\d[\d\s-]{7,14}\d)\b/, raw);
  if (phone) {
    slots.phone = phone.replace(/\s+/g, '');

    // When phone is found but NO name yet, try to extract name from the word
    // immediately before the phone number. Handles non-comma input like
    // "John +911234567890 5pm tomorrow" where "John" wouldn't match the
    // "i am / my name is" prefix regex.
    if (!slots.name) {
      const rawNormalized = raw.replace(/\s+/g, ' ');
      const phoneClean = slots.phone;
      const phoneIdx = rawNormalized.indexOf(phoneClean);
      if (phoneIdx > 0) {
        const beforePhone = rawNormalized.slice(0, phoneIdx).trim().split(/\s+/).pop() || '';
        if (
          /^[A-Z][a-zA-Z]{1,20}$/.test(beforePhone) &&
          !NON_CITY_WORDS.has(normalize(beforePhone))
        ) {
          slots.name = beforePhone;
        }
      }
    }
  }

  if (!slots.name) {
    const name = pick(/\b(?:name|full name|i am|i'm|my name is)\s*[:\-]?\s*([a-zA-Z .'-]{2,40})/i, raw);
    if (name) slots.name = name;
  }
  // Name from comma format is handled in tryParseCommaFormat

  const callbackTime = parseCallbackTime(raw);
  if (callbackTime) slots.callback_time = callbackTime;

  // Try comma-separated format if we still have missing common fields
  const commaSlots = tryParseCommaFormat(raw, intent, { ...knownSlots, ...slots });
  return mergeSlots(slots, commaSlots);
}

function mergeSlots(base: WorkflowSlotMap, next: WorkflowSlotMap): WorkflowSlotMap {
  const merged = { ...base };
  for (const [key, val] of Object.entries(next)) {
    if (val && !merged[key as keyof WorkflowSlotMap]) {
      (merged as Record<string, string>)[key] = val;
    }
  }
  return merged;
}

// â”€â”€â”€ stage resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function resolveStage(intent: WorkflowIntent, slots: WorkflowSlotMap): WorkflowStage {
  if (intent === 'unknown') return 'unknown';

  // Standalone callback request (no prior travel service)
  if (intent === 'callback_request') {
    if (!slots.name || !slots.phone) return 'collect_lead';
    return slots.callback_time ? 'confirmed' : 'ask_callback';
  }

  // If user explicitly requests a callback at ANY stage, skip travel collection
  // and go straight to collecting contact info â†’ callback time.
  if (slots.post_package_action === 'arrange_callback') {
    const hasRequiredLead = Boolean(slots.name && slots.phone);
    if (!hasRequiredLead) return 'collect_lead';
    return slots.callback_time ? 'confirmed' : 'ask_callback';
  }

  if (intent === 'plan_holiday') {
    if (!slots.destination) return 'ask_destination';
    if (!slots.holiday_type) return 'ask_holiday_type';

    const travelMissing =
      !slots.travellers || !slots.travel_time || !slots.departure_city || !slots.nights;
    const needsHotelPref = slots.holiday_type === 'personalized' && !slots.hotel_preference;

    if (travelMissing || needsHotelPref) return 'ask_travel_details';

    const hasPostAction = Boolean(slots.post_package_action);
    const hasContactStart = Boolean(slots.name || slots.phone);
    const hasRequiredLead = Boolean(slots.name && slots.phone);

    if (hasPostAction || hasContactStart) {
      if (!hasRequiredLead) return 'collect_lead';
      return slots.callback_time ? 'confirmed' : 'ask_callback';
    }

    return 'show_packages';
  }

  if (intent === 'flights') {
    if (!slots.from_city || !slots.to_city || !slots.travel_time || !slots.travellers) {
      return 'ask_travel_details';
    }
    const hasPostAction = Boolean(slots.post_package_action);
    const hasContactStart = Boolean(slots.name || slots.phone);
    const hasRequiredLead = Boolean(slots.name && slots.phone);
    if (hasPostAction || hasContactStart) {
      if (!hasRequiredLead) return 'collect_lead';
      return slots.callback_time ? 'confirmed' : 'ask_callback';
    }
    return 'show_packages';
  }

  if (intent === 'hotels') {
    if (!slots.destination || !slots.travellers || !slots.travel_time || !slots.nights) {
      return 'ask_travel_details';
    }
    const hasPostAction = Boolean(slots.post_package_action);
    const hasContactStart = Boolean(slots.name || slots.phone);
    const hasRequiredLead = Boolean(slots.name && slots.phone);
    if (hasPostAction || hasContactStart) {
      if (!hasRequiredLead) return 'collect_lead';
      return slots.callback_time ? 'confirmed' : 'ask_callback';
    }
    return 'show_packages';
  }

  // Other intents: transfer, forex, visa, insurance, mice, booking_status
  if (!slots.name || !slots.phone) return 'collect_lead';
  return slots.callback_time ? 'confirmed' : 'ask_callback';
}

// â”€â”€â”€ public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function shouldResetState(message: string): boolean {
  const text = normalize(message);
  return hasAny(text, [
    'start over', 'reset', 'new request', 'new enquiry', 'new inquiry',
    'main menu', 'go back', 'back to menu', 'restart', 'cancel',
    'start again', 'start fresh', 'begin again',
  ]);
}

// Returns true when the user's message looks like a question or off-topic text
// that the AI should handle with a brief answer before re-asking the required info.
export function isQuestionLike(message: string): boolean {
  const t = normalize(message);
  if (t.endsWith('?')) return true;
  if (/^(what|how|why|when|where|who|which|can|is|are|do|does|will|should|could|would|tell me)\b/.test(t)) return true;
  if (/\b(tell me|explain|information about|info about|what about)\b/.test(t)) return true;
  return false;
}

export function isTravelOrPlatformQueryLike(message: string): boolean {
  const t = normalize(message);
  if (!t) return false;
  if (isQuestionLike(message)) return true;

  const businessQuery =
    /\b(about traventions|about sini|your services|services you offer|what do you offer|do you offer|can you help with|can you do|do you do|share your website|website|office location|office address|contact number|contact details|business hours|working hours|timings|refund policy|cancellation policy|payment options|emi|support team|human agent|speak to team|platform|dashboard|crm|google business profile|gbp|campaigns?)\b/.test(t);
  if (businessQuery) return true;

  const travelInfoQuery =
    /\b(visa|passport|transit|currency|forex|exchange rate|baggage|luggage|check in|check-in|weather|temperature|best time|best season|documents required|travel insurance|airport transfer|pickup|drop|fare rules|refundable|non refundable|price details|cost details|hotel details|flight details|package details|itinerary|inclusions|exclusions|meal plan|star hotel|room type|sightseeing)\b/.test(t);
  if (!travelInfoQuery) return false;

  // Avoid treating plain slot-only payloads as queries.
  if (/^\d+\s*(adults?|children|kids?|nights?|days?)\b/.test(t)) return false;
  if (/^[a-z\s]+,\s*\d+\s*(adults?|children|kids?),\s*[a-z0-9\s-]+,\s*\d+\s*nights?$/i.test(String(message || '').trim())) {
    return false;
  }

  return true;
}

function findLockedIntentFromHistory(historyMessages: string[]): WorkflowIntent | null {
  let fallbackIntent: WorkflowIntent | null = null;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const msg = historyMessages[i] || '';
    // A greeting marks the start of a new session â€” stop scanning here so old
    // session messages cannot bleed their intent into the current session.
    if (isGreetingLike(msg)) break;
    const intent = detectWorkflowIntent(msg);
    if (intent === 'unknown') continue;
    if (intent === 'callback_request') {
      fallbackIntent = fallbackIntent || intent;
      continue;
    }
    return intent;
  }
  return fallbackIntent;
}

// Returns the index in historyMessages from which to START parsing slots.
// Scopes slot accumulation to the current session + current service selection
// so old-session data and switched-service data never pollute the current flow.
function findSlotStartIndex(historyMessages: string[], intent: WorkflowIntent): number {
  // Step 1: last greeting = session boundary
  let sessionStart = 0;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    if (isGreetingLike(historyMessages[i])) {
      sessionStart = i + 1;
      break;
    }
  }

  // Step 2: within session, find last explicit service selection for this intent.
  // E.g. if user did Hotels â†’ then switched to "Plan a Holiday", we start
  // accumulating slots from the "Plan a Holiday" message, ignoring the Hotels part.
  for (let i = historyMessages.length - 1; i >= sessionStart; i--) {
    const msg = historyMessages[i];
    if (isDirectServiceSelection(msg) && detectWorkflowIntent(msg) === intent) {
      return i; // include this message (defines intent) onward
    }
  }

  return sessionStart;
}

// Returns true only when the message is an explicit, unambiguous service selection
// (button tap, single keyword, or "Plan a Holiday" / "Flights" / "Hotels").
// Used to decide whether the current message can override a locked intent from history.
function isDirectServiceSelection(message: string): boolean {
  const text = normalizeSelectionText(message);
  if (/^(svc_1|svc_2|svc_3|1|2|3)$/.test(text)) return true;
  if (/^(plan a holiday|plan holiday|flights?|hotels?|visa|transfer|forex|insurance|mice|booking status)$/.test(text)) {
    return true;
  }
  // Accept common interactive payload variants like:
  // "1 plan a holiday", "2 flights", "3 hotels"
  if (/^(1|2|3)\s+(plan a holiday|plan holiday|flights?|hotels?)$/.test(text)) return true;
  return false;
}

// Primary menu/service taps should start a fresh requirement-collection flow.
// (Digits intentionally excluded so "1/2/3" can still act as package selection in show_packages.)
function isPrimaryServiceSelection(message: string): boolean {
  const text = normalizeSelectionText(message);
  if (/^(svc_1|svc_2|svc_3|plan a holiday|plan holiday|flights?|hotels?)$/.test(text)) return true;
  // Handle interactive labels that include numeric prefixes.
  if (/^(1|2|3)\s+(plan a holiday|plan holiday|flights?|hotels?)$/.test(text)) return true;
  return false;
}

function isTravelSalesIntent(intent: WorkflowIntent): boolean {
  return intent === 'plan_holiday' || intent === 'flights' || intent === 'hotels';
}

function looksLikeShowPackagesRefinement(
  message: string,
  intent: WorkflowIntent,
  parsedSlots: WorkflowSlotMap
): boolean {
  const text = normalize(message);
  if (!text || !isTravelSalesIntent(intent)) return false;

  if (
    parsedSlots.destination ||
    parsedSlots.from_city ||
    parsedSlots.to_city ||
    parsedSlots.travel_time ||
    parsedSlots.travellers ||
    parsedSlots.departure_city ||
    parsedSlots.nights ||
    parsedSlots.checkin ||
    parsedSlots.checkout ||
    parsedSlots.budget_inr ||
    parsedSlots.hotel_preference
  ) {
    return true;
  }

  if (/\b(show me|send me|suggest|recommend|looking for|i want|need|prefer|instead|rather|more|best|cheapest|affordable|budget friendly|budget-friendly)\b/.test(text)) {
    return true;
  }

  if (intent === 'hotels') {
    return /\b(3 star|4 star|5 star|hotel|hotels|resort|stay|pool|breakfast|beachfront|family|honeymoon|near|location|budget|luxury|premium)\b/.test(text);
  }

  if (intent === 'flights') {
    return /\b(flight|flights|direct|nonstop|non-stop|one stop|morning|evening|refundable|business class|premium economy|window|aisle|budget|cheapest)\b/.test(text);
  }

  return /\b(package|packages|family|honeymoon|adventure|relaxation|luxury|budget|premium|personalized|personalised|custom)\b/.test(text);
}

export function resolveWorkflowState(args: {
  userMessage: string;
  classifiedIntent?: string;
  selectedIntent?: WorkflowIntent | null;
  aiSlots?: WorkflowSlotMap;
  historyMessages?: string[];
}): WorkflowState {
  const historyMessages = args.historyMessages || [];
  const msgIntent = detectWorkflowIntent(args.userMessage, args.classifiedIntent);
  const selected = args.selectedIntent && args.selectedIntent !== 'unknown' ? args.selectedIntent : null;
  const locked = (shouldResetState(args.userMessage) || isGreetingLike(args.userMessage))
    ? null
    : findLockedIntentFromHistory(historyMessages);

  // Locked intent from history wins unless the current message is an explicit,
  // unambiguous service selection (button tap / single keyword).
  // This prevents travel-detail messages like "2 Adults, July, Bangalore, 5 Nights"
  // from accidentally overriding the locked plan_holiday intent.
  const canOverrideLocked = !locked || isDirectServiceSelection(args.userMessage);
  // resolvedOverride: prefer explicitly-passed selectedIntent, fall back to detected msgIntent.
  // This ensures that when the user taps "Hotels" and locked='plan_holiday', the Hotels
  // intent wins (selected is null but msgIntent='hotels', so resolvedOverride='hotels').
  const resolvedOverride: WorkflowIntent | null =
    selected ?? (msgIntent !== 'unknown' ? msgIntent : null);
  const intent: WorkflowIntent =
    (canOverrideLocked && resolvedOverride)
      ? resolvedOverride
      : locked
        ? locked
        : selected || (msgIntent !== 'unknown' ? msgIntent : 'unknown');
  const source: WorkflowState['source'] = (canOverrideLocked && resolvedOverride)
    ? (selected ? 'selected_now' : 'detected_now')
    : locked
      ? 'locked_history'
      : 'detected_now';

  if (intent === 'unknown') {
    return { intent, stage: 'unknown', source, slots: {}, missingSlots: [], complete: false, leadShouldBeSaved: false };
  }

  // Only accumulate slots from the current session + current service selection.
  // Prevents old-session data (e.g. previous travellers/dates/post_package_action)
  // from polluting a fresh conversation and making the bot skip stages.
  const slotStart = isPrimaryServiceSelection(args.userMessage)
    ? historyMessages.length
    : findSlotStartIndex(historyMessages, intent);
  const sessionMessages = historyMessages.slice(slotStart);

  // Lead slots (name, phone, email, callback_time) require special scoping.
  // They must NOT be pulled from session history when the user has just triggered
  // lead collection (by tapping Arrange Callback / Get Details) â€” old-session contact
  // info would otherwise skip the collect_lead stage entirely.
  // Strategy:
  //   1. Parse only travel/service slots from full session history.
  //   2. Find the last message in session history that set post_package_action.
  //   3. Only if that anchor exists (we're CONTINUING lead collection, not starting it),
  //      pull lead slots from messages strictly AFTER the anchor â€” and only if no
  //      service-selection reset happened after it.
  //   4. Always parse all slots from the current message.
  const LEAD_SLOT_KEYS = ['name', 'phone', 'email', 'callback_time'] as const;

  let slots: WorkflowSlotMap = {};
  for (const item of sessionMessages) {
    const parsed = parseGeneralSlots(item, intent, slots);
    const travelOnly = { ...parsed };
    for (const k of LEAD_SLOT_KEYS) delete travelOnly[k];
    slots = mergeSlots(slots, travelOnly);
  }

  // Find last post_package_action anchor in session history
  let lastPpaIdx = -1;
  for (let i = sessionMessages.length - 1; i >= 0; i--) {
    const p = parseGeneralSlots(sessionMessages[i], intent, {});
    if (p.post_package_action) { lastPpaIdx = i; break; }
  }
  if (lastPpaIdx !== -1) {
    // Verify no service-selection reset happened after the anchor
    const afterAnchor = sessionMessages.slice(lastPpaIdx + 1);
    const resetAfter = afterAnchor.some(m => isDirectServiceSelection(m) || isGreetingLike(m));
    if (!resetAfter) {
      for (const item of afterAnchor) {
        const parsed = parseGeneralSlots(item, intent, slots);
        for (const k of LEAD_SLOT_KEYS) {
          if (parsed[k] && !slots[k]) (slots as Record<string, string>)[k] = parsed[k] as string;
        }
      }
    }
  }

  const currentMessageSlots = parseGeneralSlots(args.userMessage, intent, slots);
  slots = mergeSlots(slots, currentMessageSlots);
  // AI-extracted slot hints are a fallback layer: they only fill still-missing fields
  // and never override slots already captured by deterministic parsing.
  if (args.aiSlots) {
    slots = mergeSlots(slots, args.aiSlots);
  }

  // SAFETY: Prevent lead bleed from skipping collect_lead.
  // If the current message sets post_package_action AND no lead has been
  // explicitly provided AFTER the last post_package_action in session history,
  // clear only post-PPA accumulated lead slots so the bot asks fresh.
  // Pre-PPA lead slots (e.g. "My name is John" said before "arrange callback")
  // are preserved — they were legitimately provided by the user.
  const currentMsgPpa = currentMessageSlots.post_package_action;
  if (currentMsgPpa) {
    const currentMsgProvidesLead = Boolean(
      currentMessageSlots.callback_time ||
      currentMessageSlots.name ||
      currentMessageSlots.phone ||
      currentMessageSlots.email
    );
    if (!currentMsgProvidesLead) {
      const msgsAfterLastPpa = lastPpaIdx !== -1
        ? sessionMessages.slice(lastPpaIdx + 1)
        : [];
      const leadProvidedAfterPpa = msgsAfterLastPpa.some(m => {
        const p = parseGeneralSlots(m, intent, {});
        return Boolean(p.name || p.phone || p.callback_time);
      });
      if (!leadProvidedAfterPpa) {
        // Determine which lead slots were set in pre-PPA messages (from session history
        // BEFORE the first PPA anchor). Those are legitimate user-provided data and
        // must NOT be cleared. Only clear slots that were NOT set pre-PPA.
        const firstPpaIdx = (() => {
          for (let i = 0; i < sessionMessages.length; i++) {
            const p = parseGeneralSlots(sessionMessages[i], intent, {});
            if (p.post_package_action) return i;
          }
          return -1;
        })();
        const prePpaSlots = new Set<string>();
        if (firstPpaIdx > 0) {
          for (let i = 0; i < firstPpaIdx; i++) {
            const p = parseGeneralSlots(sessionMessages[i], intent, {});
            for (const k of LEAD_SLOT_KEYS) {
              if (p[k]) prePpaSlots.add(k);
            }
          }
        }
        for (const k of LEAD_SLOT_KEYS) {
          if (!prePpaSlots.has(k)) delete (slots as Record<string, string>)[k];
        }
      }
    }
  }

  const currentLooksLikeRefinement = looksLikeShowPackagesRefinement(
    args.userMessage,
    intent,
    currentMessageSlots
  );
  const currentHasLeadData = Boolean(
    currentMessageSlots.name ||
    currentMessageSlots.phone ||
    currentMessageSlots.email ||
    currentMessageSlots.callback_time
  );
  const currentRequestsCallback =
    currentMessageSlots.post_package_action === 'arrange_callback' || msgIntent === 'callback_request';

  // If the user shifts back into travel refinement mode, clear any stale
  // callback/lead-collection state carried from earlier turns in the same session.
  if (
    isTravelSalesIntent(intent) &&
    currentLooksLikeRefinement &&
    !currentHasLeadData &&
    !currentRequestsCallback
  ) {
    delete slots.post_package_action;
    delete slots.name;
    delete slots.phone;
    delete slots.email;
    delete slots.callback_time;
  }

  // If "customize" is selected as post_package_action, switch to personalized
  if (slots.post_package_action === 'customize') {
    slots.holiday_type = 'personalized';
  }

  // Stage-aware overrides â€” applied BEFORE final stage resolution.
  const preStage = resolveStage(intent, slots);

  // show_packages: detect bare number/keyword selections as post_package_action
  // so the flow advances to collect_lead instead of repeating the packages.
  if (preStage === 'show_packages' && !slots.post_package_action) {
    const msg = args.userMessage.trim();
    const msgL = normalize(msg);
    const looksLikeRefinement = looksLikeShowPackagesRefinement(msg, intent, currentMessageSlots);
    if (!looksLikeRefinement && (
        /^[123]$/.test(msg) ||
        /^(budget|premium|luxury|package [123]|option [123]|deal [123])$/i.test(msgL) ||
        /^(get package|get detail|get details|package detail|flight details?|get flight details?|hotel details?|get hotel details?)$/i.test(msgL) ||
        /^(itinerary|day wise|day-wise|day by day)$/i.test(msgL)
      )) {
      slots.post_package_action = 'get_details';
    } else if (/\b(customis|customiz|modify|edit plan|change plan|customise flights?|customize flights?|customise hotels?|customize hotels?)\b/i.test(msgL)) {
      slots.post_package_action = 'customize';
    } else if (/^(callback|call me|call back|arrange call|arrange callback)$/i.test(msgL)) {
      slots.post_package_action = 'arrange_callback';
    }
  }

  // Callback fallback: treat the entire short message as callback time when
  // all lead info is collected but callback_time is still missing.
  // Handles freeform responses like "evening tomorrow" or "5 pm on saturday"
  // or even just "evening" / "night" / "afternoon".
  // NOTE: isCallbackActionOnly guard was REMOVED because it blocked messages
  // that contain BOTH "callback" keyword AND a time (e.g. "I want a callback at 5pm").
  // parseCallbackTime already returns null for pure "I want a callback" (no time),
  // so the guard was redundant and actively harmful.
  if (preStage === 'ask_callback' && !slots.callback_time) {
    const msg = args.userMessage.trim();
    const msgL = normalize(msg);
    if (msg && msg.length <= 60) {
      const parsedCallbackTime = parseCallbackTime(msg);
      const looksLikeNewIntent =
        detectWorkflowIntent(msg) !== 'unknown' || isGreetingLike(msg);
      if (!looksLikeNewIntent && parsedCallbackTime) {
        slots.callback_time = parsedCallbackTime;
      } else if (!looksLikeNewIntent && !parsedCallbackTime && msgL.length <= 20 && !msgL.match(/\d/)) {
        // Last-chance fallback: short plain-text like "evening", "night", "afternoon"
        const timeWords = /\b(morning|afternoon|evening|night|midnight|noon|today|tomorrow|tonight|weekend|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
        const match = msg.match(timeWords);
        if (match && msg.replace(timeWords, '').trim().length <= 5) {
          slots.callback_time = match[0];
        }
      }
    }
  }

  const stage = resolveStage(intent, slots);
  const complete = stage === 'confirmed';
  const leadShouldBeSaved = complete;

  // missingSlots kept for backward compat â€” list what's still needed
  const missingSlots: string[] = [];
  if (intent === 'plan_holiday') {
    if (!slots.destination) missingSlots.push('destination');
    if (!slots.holiday_type) missingSlots.push('holiday_type');
    if (!slots.travellers) missingSlots.push('travellers');
    if (!slots.travel_time) missingSlots.push('travel_time');
    if (!slots.departure_city) missingSlots.push('departure_city');
    if (!slots.nights) missingSlots.push('nights');
  } else if (intent === 'flights') {
    if (!slots.from_city) missingSlots.push('from_city');
    if (!slots.to_city) missingSlots.push('to_city');
    if (!slots.travel_time) missingSlots.push('travel_time');
    if (!slots.travellers) missingSlots.push('travellers');
  } else if (intent === 'hotels') {
    if (!slots.destination) missingSlots.push('destination');
    if (!slots.travellers) missingSlots.push('travellers');
    if (!slots.travel_time) missingSlots.push('travel_time');
    if (!slots.nights) missingSlots.push('nights');
  } else if (intent === 'callback_request') {
    // only lead slots matter
  }
  if (!slots.name) missingSlots.push('name');
  if (!slots.phone) missingSlots.push('phone');
  if (!slots.callback_time) missingSlots.push('callback_time');

  return { intent, stage, source, slots, missingSlots, complete, leadShouldBeSaved };
}

// â”€â”€â”€ reply builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function getBrochureLink(intent: WorkflowIntent): string | null {
  const map: Record<string, string> = {
    plan_holiday: BROCHURE_URLS.holiday_packages,
    flights: BROCHURE_URLS.flight_bookings,
    hotels: BROCHURE_URLS.hotel_bookings,
  };
  return map[intent] || null;
}

export function buildBrochureOffer(intent: WorkflowIntent, name?: string | null): string {
  const link = getBrochureLink(intent);
  if (!link) return '';
  const greeting = name ? `${name.split(' ')[0]}, ` : '';
  return `\n\n📚 ${greeting}would you like me to send you our **brochure** with detailed options? Just reply *yes* and I'll share it right away!`;
}

const DESTINATION_TAGLINES: Record<string, string> = {
  thailand: 'perfect for beaches, nightlife, and relaxation',
  bali: 'a magical island paradise',
  kashmir: 'truly paradise on earth',
  dubai: 'a world of luxury and adventure',
  maldives: 'perfect for beaches and crystal waters',
  singapore: 'a vibrant city of culture and food',
  europe: 'a dream destination for history lovers',
  kerala: 'God\'s own country',
  goa: 'India\'s beach paradise',
};

function getDestinationTagline(destination: string): string {
  const key = normalize(destination).split(' ')[0];
  return DESTINATION_TAGLINES[key] || 'a wonderful destination';
}

export function buildWorkflowReply(state: WorkflowState): string | null {
  if (state.intent === 'unknown' || state.stage === 'unknown') return null;

  const { stage, slots, intent } = state;
  const joinMissing = (items: string[]) => {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  };

  // â”€â”€ ask_destination â”€â”€
  if (stage === 'ask_destination') {
    return (
      'That sounds lovely! 🌍\n\n' +
      'Which destination are you planning for? 🗺️\n\n' +
      'Example: Dubai, Bali, Kashmir, Thailand ✨'
    );
  }

  // â”€â”€ ask_holiday_type â”€â”€
  if (stage === 'ask_holiday_type') {
    const dest = slots.destination || 'your chosen destination';
    const tagline = getDestinationTagline(dest);
    return (
      `Great choice! ${dest} is ${tagline}. 🌟\n\n` +
      'Would you prefer ready holiday options or a more personalized plan? 🤔\n\n' +
      '1️⃣ Exclusive Holiday Deals 🎯\n' +
      '2️⃣ Personalized Holidays ✨'
    );
  }

  // â”€â”€ ask_travel_details â”€â”€
  if (stage === 'ask_travel_details') {
    if (intent === 'plan_holiday') {
      if (slots.holiday_type === 'personalized') {
        const dest = slots.destination || 'your destination';
        const missing = [
          !slots.travellers ? 'number of travellers' : '',
          !slots.travel_time ? 'travel month or dates' : '',
          !slots.departure_city ? 'departure city' : '',
          !slots.nights ? 'number of nights' : '',
          !slots.hotel_preference ? 'hotel preference' : '',
        ].filter(Boolean);
        return (
          `Lovely, I'll shape a personalized ${dest} holiday for you! 🎉\n\n` +
          `Just send me your ${joinMissing(missing)} in one message if that's easy. 📝\n\n` +
          'Example:\n👨‍👩‍👧 2 Adults, 10th July, Delhi, 5 Nights, 4 Star Hotels ⭐'
        );
      }
      // exclusive
      const missing = [
        !slots.travellers ? 'number of travellers' : '',
        !slots.travel_time ? 'travel month or dates' : '',
        !slots.departure_city ? 'departure city' : '',
        !slots.nights ? 'number of nights' : '',
      ].filter(Boolean);
      return (
        `Perfect. Send me your ${joinMissing(missing)} and I'll suggest the best holiday options. 🏆\n\n` +
        'Example:\n👨‍👩‍👧 2 Adults, July, Bangalore, 5 Nights'
      );
    }

    if (intent === 'flights') {
      const missing = [
        !slots.from_city ? 'departure city' : '',
        !slots.to_city ? 'destination city' : '',
        !slots.travel_time ? 'travel date' : '',
        !slots.travellers ? 'number of travellers' : '',
      ].filter(Boolean);
      return (
        `Sure, send me your ${joinMissing(missing)} and I'll check suitable flight options. ✈️\n\n` +
        'Example:\n📍 Delhi to Mumbai, 25th June, 2 Adults 👨‍👩‍👧'
      );
    }

    if (intent === 'hotels') {
      const missing = [
        !slots.destination ? 'destination' : '',
        !slots.travellers ? 'number of travellers' : '',
        !slots.travel_time ? 'travel month or dates' : '',
        !slots.nights ? 'number of nights' : '',
      ].filter(Boolean);
      return (
        `Of course. Send me your ${joinMissing(missing)} and I'll share hotel options that fit. 🏨\n\n` +
        'Example:\n📍 Dubai, 2 Adults, July, 4 Nights 👨‍👩‍👧'
      );
    }

    // Other intents (should not reach here under current logic, but safe fallback)
    return (
      'Sure! Please share the following details: 📋\n\n' +
      '👤 Full Name\n📞 Contact Number\n⏰ Preferred Callback Time\n\n' +
      'Example: Sini, +91 9876543210, Tomorrow at 5 PM ✅'
    );
  }

  // â”€â”€ show_packages â€” AI generates all package/flight/hotel options â”€â”€
  if (stage === 'show_packages') {
    return null;
  }

  // collect_lead
  if (stage === 'collect_lead') {
    const missingLeadLines = [
      !slots.name ? '👤 - Full Name' : '',
      !slots.phone ? '📞 - Contact Number' : '',
      !slots.callback_time ? '⏰ - Preferred Callback Time' : '',
    ].filter(Boolean);

    const capturedLeadLines = [
      slots.name ? `✅ Name - ${slots.name}` : '',
      slots.phone ? `✅ Contact Number - ${slots.phone}` : '',
      slots.callback_time ? `✅ Callback Time - ${slots.callback_time}` : '',
    ].filter(Boolean);

    const exampleParts = [
      !slots.name ? 'Rahul' : '',
      !slots.phone ? '+91 9876543210' : '',
      !slots.callback_time ? 'Today at 5 PM' : '',
    ].filter(Boolean);

    const capturedBlock = capturedLeadLines.length
      ? `${capturedLeadLines.join('\n')}\n\n`
      : '';
    const exampleBlock = exampleParts.length
      ? `Example: ${exampleParts.join(', ')}\n\n`
      : '';

    return (
      'I can arrange a quick call from our travel expert. 📞🤝\n\n' +
      'Please share the remaining details: 📝\n\n' +
      capturedBlock +
      `${missingLeadLines.join('\n')}\n\n` +
      exampleBlock +
      'We will call you at the time that suits you best. 😊'
    ) + buildBrochureOffer(intent, slots.name);
  }

  // ask_callback
  if (stage === 'ask_callback') {
    const name = slots.name ? `, ${slots.name}` : '';
    return (
      `Thanks${name}. 🙏\n\n` +
      'What time would be convenient for your callback? ⏰\n\n' +
      'Example: Today at 5 PM 🌇 / Tomorrow Morning 🌅'
    ) + buildBrochureOffer(intent, slots.name);
  }

  // â”€â”€ confirmed â€” AI handles both initial confirmation and YES/NO follow-up â”€â”€
  if (stage === 'confirmed') {
    const brochureOffer = buildBrochureOffer(intent, slots.name);
    if (brochureOffer) return brochureOffer;
    return null;
  }

  return null;
}

function normalizeAssistantMessageForStateCheck(message: string | null | undefined): string {
  return String(message || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCallbackConfirmationMessage(message: string | null | undefined): boolean {
  const text = normalizeAssistantMessageForStateCheck(message);
  return text.includes('callback has been scheduled successfully');
}

export function isConversationClosureReply(message: string | null | undefined): boolean {
  const text = normalizeSelectionText(message || '');
  if (!text) return false;
  return /^(no|nope|nah|not now|nothing else|thats all|that s all|all good|done|bye|ok thanks|okay thanks|thanks|thank you|no thanks|no thank you)$/.test(text);
}

export function isAffirmativeContinuationReply(message: string | null | undefined): boolean {
  const text = normalizeSelectionText(message || '');
  if (!text) return false;
  return /^(yes|yeah|yep|sure|ok|okay|please do|go ahead|continue|help me|tell me more)$/.test(text);
}

export function buildConfirmedWorkflowReply(args: {
  state: WorkflowState;
  userMessage: string;
  lastAssistantMessage?: string | null;
}): string {
  const { state, userMessage, lastAssistantMessage } = args;
  const slots = state.slots || {};
  const name = slots.name ? `, ${slots.name}` : '';
  const callbackTime = slots.callback_time || 'at the earliest';
  const ctx = state.intent === 'flights'
    ? 'assist you with the best flight options'
    : state.intent === 'hotels'
      ? 'assist you with the best hotel options'
      : 'assist you with complete package details';

  if (!isCallbackConfirmationMessage(lastAssistantMessage)) {
    return (
      `Perfect${name}! Your callback has been scheduled successfully. ✅📞\n\n` +
      `Our travel expert will contact you *${callbackTime}* and ${ctx}. 🤝\n\n` +
      'Is there anything else I may assist you with today? 😊'
    );
  }

  if (isConversationClosureReply(userMessage)) {
    return (
      'Thank you for your time! 🙏⏰\n' +
      'We truly appreciate your support. ❤️\n\n' +
      'Kindly rate your experience with us ⭐⭐⭐⭐⭐:\n' +
      'https://www.google.com/search?q=Traventions+India+Pvt+Ltd+Reviews'
    );
  }

  if (isAffirmativeContinuationReply(userMessage)) {
    return (
      'How may I assist you today?\n\n' +
      '1️⃣ Plan a Holiday 🏖️\n' +
      '2️⃣ Flights ✈️\n' +
      '3️⃣ Hotels 🏨'
    );
  }

  return (
    'How may I assist you today?\n\n' +
    '1️⃣ Plan a Holiday 🏖️\n' +
    '2️⃣ Flights ✈️\n' +
    '3️⃣ Hotels 🏨'
  );
}

// â”€â”€â”€ intent detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function detectWorkflowIntent(message: string, classifiedIntent?: string): WorkflowIntent {
  const raw = autoCorrect(message);           // fix typos before detection
  const text = normalize(raw);
  const intentText = normalize(classifiedIntent || '');
  const joined = `${text} ${intentText}`;

  // Digit menu selections (1/2/3) only fire when the ENTIRE message is that digit.
  // This prevents "2 adults" or "2, june, ..." from being classified as "Flights".
  const isDigitSelect = (n: string) => new RegExp(`^${n}\\.?\\s*$`).test(text);

  const hasFlightKeyword =
    /(^|\s)(svc_2|flight|flights|fligth|fligths|air ticket|airticket|airfare)(\s|$)/.test(joined);

  // plan_holiday â€” fuzzy-match "holiday", "package", "tour", "leisure"
  if (
    isDigitSelect('1') ||
    /(^|\s)(svc_1|plan holiday|plan a holiday|holiday package|holiday|leisure|tour package)(\s|$)/.test(joined) ||
    fuzzyAny(text, ['holiday', 'package', 'tour', 'leisure'])
  ) {
    // Explicit digit-1, svc_1, or the phrase "plan a holiday" always wins â€” even if the
    // message also contains "flights"/"hotels" (e.g. the user echoing the quick-reply menu).
    const explicitPlanHoliday =
      isDigitSelect('1') ||
      /(^|\s)(svc_1|plan a holiday|plan holiday)(\s|$)/.test(text);
    const flightLike = hasFlightKeyword;
    const hotelLike = isDigitSelect('3') || /(^|\s)(svc_3|hotel|hotels|stay|resort)(\s|$)/.test(joined);
    if (explicitPlanHoliday || (!flightLike && !hotelLike)) return 'plan_holiday';
  }

  // flights â€” strict keyword matching only (avoid false positives like "nights")
  if (
    isDigitSelect('2') ||
    hasFlightKeyword
  ) {
    return 'flights';
  }

  // hotels
  if (isDigitSelect('3') || /(^|\s)(svc_3|hotel|hotels|stay|resort)(\s|$)/.test(joined)) {
    return 'hotels';
  }

  // Multi-slot travel data â†’ plan_holiday
  if (
    /(destination|travel month|travel date|travel dates|budget|package)/.test(joined) &&
    /(travellers|travelers|adults?|pax|nights?)/.test(joined)
  ) {
    return 'plan_holiday';
  }
  if (/\bfrom\b.+\bto\b.+(\bpassengers?\b|\bpax\b|\badults?\b)/.test(joined)) {
    return 'flights';
  }

  if (/(airport transfer|transfer|pickup|drop)/.test(joined)) return 'transfer';
  if (fuzzyAny(text, ['forex']) || /(currency exchange|money exchange)/.test(joined)) return 'forex';
  if (fuzzyAny(text, ['visa'])) return 'visa';
  if (fuzzyAny(text, ['insurance'])) return 'insurance';
  if (/(mice|corporate event|meetings incentives conferences exhibitions)/.test(joined)) return 'mice';
  if (/(booking status|status|pnr|reference|booking id)/.test(joined)) return 'booking_status';

  // standalone callback request
  // Any message mentioning "callback" that hasn't matched a service intent above
  // is treated as a callback request. This catches "I want a callback",
  // "I need a callback", "callback tomorrow at 3 pm", etc.
  if (/\b(callback|call\s*me|call\s*back)\b/i.test(joined)) {
    return 'callback_request';
  }

  return 'unknown';
}

// System prompt helpers

export function buildConversationMemoryBlock(args: {
  state: WorkflowState;
  recentUserMessages?: string[];
  recentMessages?: Array<{
    role?: 'user' | 'assistant' | 'system';
    content?: string;
  }>;
}): string {
  const recent = (args.recentUserMessages || []).filter(Boolean).slice(-12);
  const transcript = (args.recentMessages || [])
    .filter((item) => item?.content)
    .slice(-16);
  const slotPairs = Object.entries(args.state.slots || {}).filter(([, v]) => Boolean(v));
  const slotText =
    slotPairs.length > 0
      ? slotPairs.map(([k, v]) => `${k}: ${v}`).join(' | ')
      : 'none yet';
  const recentText =
    recent.length > 0
      ? recent.map((v, i) => `${i + 1}. "${v}"`).join('\n')
      : 'none';
  const transcriptText =
    transcript.length > 0
      ? transcript
          .map((item, i) => `${i + 1}. ${(item.role || 'assistant').toUpperCase()}: "${item.content}"`)
          .join('\n')
      : 'none';

  return [
    'CONVERSATION MEMORY (AUTHORITATIVE - follow exactly)',
    `Intent  : ${args.state.intent}`,
    `Stage   : ${args.state.stage}`,
    `Collected slots: ${slotText}`,
    `Missing : ${args.state.missingSlots.length ? args.state.missingSlots.join(', ') : 'none - all collected'}`,
    'Recent full chat turns (oldest -> newest):',
    transcriptText,
    'Recent user messages (oldest -> newest):',
    recentText,
    'RULE: Never re-ask for already captured slots. Never contradict captured data.',
  ].join('\n');
}

export function getWorkflowSystemPromptBlock(
  intent: WorkflowIntent,
  stage?: WorkflowStage,
  slots?: WorkflowSlotMap,
  stageDraftReply?: string | null
): string {
  const intentLabel = intent === 'unknown' ? 'not yet identified' : intent.replace(/_/g, ' ');
  const stageLabel = stage || 'unknown';
  const collected = Object.entries(slots || {})
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'nothing yet';

  // â”€â”€ per-stage task instructions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let task = '';

  if (intent === 'unknown' || stage === 'unknown') {
    task = `The customer's intent is not yet identified. Respond warmly and naturally.
Guidelines:
- Greeting (Hi, Hello, etc.) -> warmly greet and invite the travel requirement naturally, then offer: "1️⃣ Plan a Holiday 🏖️  2️⃣ Flights ✈️  3️⃣ Hotels 🏨"
- Travel-related question -> answer directly first, and only offer options if needed
- Off-topic question (weather, jokes, math, etc.) -> politely say you can help with travel planning and booking support
- Confused or unclear message -> respond with empathy and ask what kind of trip they are planning
- User says they want to speak to a human -> say "Sure, our team can take it from here. You can also share your trip details and I will help right away."
- Profanity or frustration -> stay calm, acknowledge the concern, and help move the conversation forward
- Random characters/test messages -> respond briefly and warmly, without sounding automated
Do not sound like a scripted bot.`;

  } else if (intent === 'callback_request') {
    if (stage === 'collect_lead') {
      task = `The customer has requested a callback. Ask for their Full Name and Phone Number before asking callback time. Do NOT ask about travel details.
If they ask any travel-related or Traventions/platform/business question, answer it briefly first, then return to the missing lead details.`;
    } else if (stage === 'ask_callback') {
      task = `Ask for the preferred callback time only. Already have name and phone.
If they ask any travel-related or Traventions/platform/business question, answer it briefly first, then ask for callback time again.`;
    } else if (stage === 'confirmed') {
      task = `Confirm that the callback has been scheduled, as described for the 'confirmed' stage below.`;
    }

  } else if (stage === 'ask_destination') {
    task = `Ask the customer which destination they want to visit.
Ask for the destination ONLY - nothing else yet.
If they ask any travel-related or Traventions/platform/business question, answer it briefly first, then return to asking the destination.`;

  } else if (stage === 'ask_holiday_type') {
    task = `Ask the customer to choose between:
1. Exclusive Holiday Deals
2. Personalized Holidays
Do NOT ask about travel details yet. Only ask for the holiday type in a natural way.
If they ask any travel-related or Traventions/platform/business question, answer it briefly first, then return to asking the holiday type.`;

  } else if (stage === 'ask_travel_details') {
    const missing: string[] = [];
    if (intent === 'plan_holiday') {
      if (!slots?.travellers)    missing.push('Number of Travellers');
      if (!slots?.travel_time)   missing.push('Travel Month or Dates');
      if (!slots?.departure_city) missing.push('Departure City');
      if (!slots?.nights)        missing.push('Number of Nights');
      if (slots?.holiday_type === 'personalized' && !slots?.hotel_preference)
        missing.push('Hotel Preference (3 / 4 / 5 Star)');
    } else if (intent === 'flights') {
      if (!slots?.from_city)  missing.push('Departure City');
      if (!slots?.to_city)    missing.push('Destination City');
      if (!slots?.travel_time) missing.push('Travel Date');
      if (!slots?.travellers) missing.push('Number of Travellers');
    } else if (intent === 'hotels') {
      if (!slots?.destination) missing.push('Destination');
      if (!slots?.travellers)  missing.push('Number of Travellers');
      if (!slots?.travel_time) missing.push('Travel Month or Dates');
      if (!slots?.nights)      missing.push('Number of Nights');
    }
    task = `Ask for ONLY these missing travel details: ${missing.length ? missing.join(', ') : 'none - all collected'}.
ALREADY COLLECTED - DO NOT ASK AGAIN: ${collected}.
If the customer asks a travel-related or Traventions/platform/business question (visa, weather, currency, website, office, services, support, etc.) -> briefly answer it, THEN re-ask the missing details in the same reply.
If the customer seems confused or off-topic -> gently redirect and re-ask the missing details.
Keep it conversational, like a real travel consultant typing on WhatsApp.`;

  } else if (stage === 'show_packages') {
    const budgetHint = slots?.destination ? destinationBudgetHint(slots.destination) : null;
    const budgetLine = budgetHint
      ? `BUDGET CONTEXT (typical per-person estimates — keep all INR figures within this band): ${budgetHint}\n`
      : '';
    if (intent === 'flights') {
      const fromCity = slots?.from_city || 'the departure city';
      const toCity = slots?.to_city || 'the destination';
      const travelTime = slots?.travel_time || 'the travel date';
      const travellers = slots?.travellers || 'the given travellers';
      task = `${budgetLine}FLIGHT OPTIONS GENERATION - REQUIRED:
Show 2 flight options from ${fromCity} to ${toCity} on ${travelTime} for ${travellers}.
Format EXACTLY as:
Option 1: Direct Flight
[Airline name] | [realistic duration] | INR [realistic price] PP (approx)
Highlights: [departure time range, arrival time, airline]

Option 2: 1-Stop Flight
[Airline name] via [hub city] | [total duration] | INR [lower price] PP (approx)
Highlights: cheaper option, [layover duration] layover at [hub]

End with:
If you'd like, I can help with:
Get Flight Details | Customise Flights | Arrange Callback
Use realistic INR pricing only. Never mention USD or $.`;

    } else if (intent === 'hotels') {
      const dest = slots?.destination || 'the destination';
      const travellers = slots?.travellers || '';
      const travelTime = slots?.travel_time || '';
      const nights = slots?.nights || '';
      const hotelPref = slots?.hotel_preference || '';
      task = `${budgetLine}HOTEL OPTIONS GENERATION - REQUIRED:
Show 3 hotel options in ${dest}${travellers ? ` for ${travellers}` : ''}${travelTime ? `, ${travelTime}` : ''}${nights ? `, ${nights} nights` : ''}${hotelPref ? ` (${hotelPref} preferred)` : ''}.
Format EXACTLY as:
[Hotel Name] | [Star Rating] | INR [realistic price per night] per night
Location: [area / neighbourhood]
Highlights: [3-4 key amenities or nearby attractions]

(repeat for all 3 hotels)

End with:
If you'd like, I can help with:
Get Hotel Details | Customise Hotels | Arrange Callback
Use realistic INR pricing only. Never mention USD or $.`;

    } else if (slots?.holiday_type === 'personalized') {
      const dest = slots?.destination || 'the destination';
      const nights = slots?.nights || '5';
      const hotelPref = slots?.hotel_preference || '4 star';
      const travellers = slots?.travellers || '';
      const travelTime = slots?.travel_time || '';
      const departureCity = slots?.departure_city || '';
      task = `${budgetLine}PERSONALIZED PACKAGE GENERATION - REQUIRED:
The customer wants a personalized holiday to ${dest} for ${travellers || 'the given travellers'}, ${travelTime || 'on the given dates'}, departing ${departureCity || 'from their city'}, ${nights} nights, ${hotelPref} hotels.
Generate exactly 5 package options named: Classic Explorer, Scenic & Relaxation, Premium Experience, Budget Friendly, Luxury Touch.
Format each as:
Option [N]: [Name]
${hotelPref} Hotels | ${nights} Nights / ${String(parseInt(nights, 10) + 1)} Days | INR [realistic price] PP
Highlights: [5 specific sightseeing/activity highlights for ${dest}]

End with:
If you'd like, I can help with:
1. Select an option  2. Get Day-wise Itinerary  3. Modify This Plan  4. Arrange Callback
Use realistic INR pricing. Never mention USD or $.`;

    } else {
      // exclusive holiday
      const dest = slots?.destination || 'the destination';
      const nights = slots?.nights || '5';
      const days = String(parseInt(nights, 10) + 1);
      const travellers = slots?.travellers || '';
      const travelTime = slots?.travel_time || '';
      const departureCity = slots?.departure_city || '';
      task = `${budgetLine}EXCLUSIVE PACKAGE GENERATION - REQUIRED:
Show 3 exclusive holiday packages for ${dest}${travellers ? ` for ${travellers}` : ''}${travelTime ? `, ${travelTime}` : ''}${departureCity ? `, departing from ${departureCity}` : ''}, ${nights} nights.
Format EXACTLY as:
Package 1: Budget Deal
3 Star Hotels | ${nights} Nights / ${days} Days | INR [realistic price] PP
Highlights: [5 specific sightseeing/activity highlights for ${dest}]

Package 2: Premium Deal
4 Star Hotels | ${nights} Nights / ${days} Days | INR [realistic price] PP
Highlights: [5 specific highlights for ${dest}]

Package 3: Luxury Experience
5 Star Hotels | ${nights} Nights / ${days} Days | INR [realistic price] PP
Highlights: [5 specific highlights for ${dest}]

End with:
If you'd like, I can help with:
Get Package Details | Customise Holiday | Arrange Callback
Use realistic INR pricing only. Never mention USD or $.`;
    }

  } else if (stage === 'collect_lead') {
    task = `Ask the customer for the remaining lead details in one warm, natural message.
Required fields are only: Full Name, Phone Number, and Preferred Callback Time.
Format example: "Rahul, +91 9876543210, Today at 5 PM"
Do NOT ask for travel details, they are already collected.
Already have: ${collected}.
Tell them our travel expert will call at their preferred time.
Do not sound like a form or checklist unless some details are still missing.
If they ask any travel-related or Traventions/platform/business question, answer it briefly first, then return to the missing lead details.`;

  } else if (stage === 'ask_callback') {
    task = `Ask ONLY for the customer's preferred callback time.
DO NOT ask for name or phone - those are already collected.
Already have: ${collected}.
Tell them a travel expert will call them at their preferred time.
Keep it short and natural.
If they ask any travel-related or Traventions/platform/business question, answer it briefly first, then ask for callback time again.`;

  } else if (stage === 'confirmed') {
    const name = slots?.name ? `, ${slots.name}` : '';
    const callbackTime = slots?.callback_time || 'at the earliest';
    const ctx = intent === 'flights'
      ? 'assist you with the best flight options'
      : intent === 'hotels'
        ? 'assist you with the best hotel options'
        : 'assist you with complete package details';
    task = `Look at the conversation history:
A) If the last assistant message does NOT already contain "callback has been scheduled":
   -> Send EXACTLY this confirmation message (replace placeholders):
   "Perfect${name}! Your callback has been scheduled successfully. ✅📞

Our travel expert will contact you *${callbackTime}* and ${ctx}. 🤝

Is there anything else I may assist you with today? 😊"

B) If the last assistant message ALREADY contains "callback has been scheduled":
   -> The customer is replying to "Is there anything else?". Handle as follows:
   - If YES or a new travel question -> reply: "How may I assist you today?\n\n1️⃣ Plan a Holiday 🏖️\n2️⃣ Flights ✈️\n3️⃣ Hotels 🏨"
   - If NO / Thank you / ending -> reply with EXACTLY:
"Thank you for your time! 🙏⏰
We truly appreciate your support. ❤️

Kindly rate your experience with us ⭐⭐⭐⭐⭐:
https://www.google.com/search?q=Traventions+India+Pvt+Ltd+Reviews"
Do NOT repeat the callback confirmation. Do NOT ask for details already collected.`;
  }

  // Draft reply as structural guide (optional)
  const draftBlock = (stageDraftReply && stage !== 'show_packages')
    ? `\nSTAGE REPLY STRUCTURE (follow this closely, adapt the wording naturally):\n${stageDraftReply}`
    : '';

  return `
TRAVEL SALES WORKFLOW - FOLLOW STRICTLY:
- Customer intent: ${intentLabel}
- Current stage: ${stageLabel}
- Collected so far: ${collected}
- YOUR TASK FOR THIS REPLY: ${task}
${draftBlock}
FORMATTING RULES (mandatory):
- WhatsApp formatting only: *bold*, _italic_, numbered lists, bullet * lists
- NEVER use markdown links [text](url) - write plain URLs only
- Friendly emojis are encouraged
- INR only for all pricing - never USD or $
- Keep reply concise and on-topic for the current stage
- Sound like a real travel consultant, not a chatbot or menu system
- Never say "I am an AI", "travel assistant bot", or anything mechanical unless the customer directly asks
- Use the customer's latest message plus chat history before asking any follow-up question
`.trim();
}

export function getGreetingIntroText(customerName?: string | null): string {
  const namePart = customerName ? `, ${customerName}` : '';
  return `Hi${namePart}! 👋 I'm *SINI* from Traventions. 🌍✈️`;
}

export function getGreetingMenuText(_customerName?: string | null): string {
  return (
    'Tell me what kind of trip you have in mind, and I’ll help from there. 🗺️✨\n\n' +
    '1️⃣ Plan a Holiday 🏖️\n' +
    '2️⃣ Flights ✈️\n' +
    '3️⃣ Hotels 🏨'
  );
}

// buildLeadNotes â€” creates a summary string for CRM notes field
export function buildLeadNotes(intent: WorkflowIntent, slots: WorkflowSlotMap): string {
  const parts: string[] = [`Source: WhatsApp AI`, `Intent: ${intent.replace('_', ' ')}`];
  if (slots.destination) parts.push(`Destination: ${slots.destination}`);
  if (slots.from_city && slots.to_city) parts.push(`Route: ${slots.from_city} -> ${slots.to_city}`);
  if (slots.travellers) parts.push(`Travellers: ${slots.travellers}`);
  if (slots.travel_time) parts.push(`Travel Date: ${slots.travel_time}`);
  if (slots.departure_city) parts.push(`Departure City: ${slots.departure_city}`);
  if (slots.nights) parts.push(`Nights: ${slots.nights}`);
  if (slots.holiday_type) parts.push(`Holiday Type: ${slots.holiday_type}`);
  if (slots.hotel_preference) parts.push(`Hotel Preference: ${slots.hotel_preference}`);
  if (slots.post_package_action) parts.push(`Interested In: ${slots.post_package_action.replace('_', ' ')}`);
  if (slots.callback_time) parts.push(`Callback Time: ${slots.callback_time}`);
  return parts.join(' | ');
}

// Legacy export kept for backward compatibility
export function getWorkflowStarterReply(intent: WorkflowIntent): string | null {
  return buildWorkflowReply({ intent, stage: 'ask_travel_details', source: 'detected_now', slots: {}, missingSlots: [], complete: false, leadShouldBeSaved: false });
}

