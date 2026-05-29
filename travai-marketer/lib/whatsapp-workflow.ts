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
  | 'unknown';

export type WorkflowStage =
  | 'ask_destination'
  | 'ask_holiday_type'
  | 'ask_travel_details'
  | 'show_packages'          // deterministic (exclusive) or AI (personalized)
  | 'collect_lead'           // ask name + phone + email
  | 'ask_callback'           // ask preferred callback time
  | 'confirmed'              // all done — save lead to CRM
  | 'unknown';

export const PRIMARY_QUICK_MENU_OPTIONS = [
  'Plan a Holiday',
  'Flights',
  'Hotels',
] as const;

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

// ─── helpers ────────────────────────────────────────────────────────────────

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

// ─── fuzzy / typo matching ───────────────────────────────────────────────────

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
  // Allow punctuation/emoji variants like "Hello!", "Hi 😊", "Good morning!!"
  // but do not treat longer intent-bearing sentences as pure greetings.
  const stripped = String(msg || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/i.test(
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
  if (hasAny(text, ['select an option', 'select option', '1️⃣', '2️⃣', '3️⃣'])) return 'get_details';
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

  const explicit = pick(
    /\b(?:callback|call me|call back|preferred time|available at|prefer|anytime|any time)\s*[:\-]?\s*([a-zA-Z0-9 :/-]{3,40})/i,
    corrected
  );
  if (explicit) return explicit;

  // Day + optional time: "Today at 5 PM", "Tomorrow morning", "Saturday afternoon"
  const timeExpr = corrected.match(
    /\b(today|tomorrow|tonight|this\s+(?:morning|afternoon|evening|week|weekend)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+[\d:]+\s*(?:am|pm)?|\s+(?:morning|afternoon|evening|night|noon))?\b/i
  );
  if (timeExpr) return timeExpr[0].trim();

  // Just a time: "5 PM", "10:30 AM", "5pm"
  const justTime = corrected.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (justTime) return justTime[0].trim();

  // "anytime", "asap", "as soon as possible", "earliest"
  if (/\b(anytime|any time|asap|earliest|convenient|whenever)\b/i.test(corrected)) {
    return corrected.trim();
  }

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
]);

// Try to parse comma-separated inputs:
// Travel: "2 Adults, July, Bangalore, 5 Nights"
// Lead:   "Sini, +91 9876543210, sini@gmail.com"
function tryParseCommaFormat(raw: string, intent: WorkflowIntent, existingSlots: WorkflowSlotMap): WorkflowSlotMap {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return {};

  const slots: WorkflowSlotMap = {};
  const monthRx = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(\s+\d{4})?$/i;
  const nightsRx = /^(\d+)\s*nights?$/i;
  const travellersRx = /^(\d+)\s*(adults?|children|kids?|pax|persons?)/i;
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
      travellersAccum.push(part);
    } else if (hotelRx.test(lp)) {
      slots.hotel_preference = lp.replace(/\s*hotels?\s*/g, '').trim();
    } else if (!slots.travel_time && dateRx.test(part) && /\d/.test(part)) {
      slots.travel_time = part;
    } else if (/^\d+$/.test(part.trim()) && !travellersAccum.length && !slots.travellers) {
      // Standalone digit (e.g. "2") — treat as traveller count
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

  // Remaining unclassified strings may be city names — apply blocklist
  const safeCityPart = (candidate: string) => {
    const key = normalize(candidate).trim();
    // Exclude parts that contain a month name — those are travel dates, not cities
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

  // from → to for flights
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
    if (isShortAlpha && !hasTravelSlots && !NOT_DESTINATIONS.has(normalize(raw))) {
      slots.destination = raw.trim();
    }
  }

  // Month/date extraction — keyword-prefixed
  const travelTime = pick(
    /\b(?:travel month|travel date|travel dates|date|on|in)\s*[:\-]?\s*([a-zA-Z0-9 ,/-]{3,40})/i,
    raw
  );
  if (travelTime) slots.travel_time = travelTime;

  // Month/date extraction — standalone (e.g. "july", "10th July")
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
    /\b(\d+\s*adults?\s*(?:,?\s*(?:and\s+)?\d+\s*(?:children|kids?|child))?)\b/i
  );
  if (travFull) {
    slots.travellers = travFull[1].trim();
  } else {
    const travellers = pick(
      /\b(?:travellers|travelers|traveller count|pax|passengers)\s*[:\-]?\s*([a-zA-Z0-9 ,/+]{1,30})/i,
      raw
    );
    if (travellers) slots.travellers = travellers;
    else {
      const pax = pick(/\b(\d+)\s*(?:pax|passengers?|adults?)\b/i, raw);
      if (pax) slots.travellers = pax;
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
  // "from [city]" pattern — catches "from Ahmedabad", "from Delhi" in holiday/hotel context
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
    /\b(?:budget|approx budget)\s*[:\-]?\s*(?:₹|inr)?\s*([0-9., ]+\s*[kKmM]?)\b/i,
    raw
  );
  if (budget) slots.budget_inr = budget.toUpperCase().replace(/\s+/g, ' ');

  const email = pick(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i, text);
  if (email) slots.email = email;

  const phone = pick(/\b(\+?\d[\d\s-]{7,14}\d)\b/, raw);
  if (phone) slots.phone = phone.replace(/\s+/g, '');

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

// ─── stage resolution ────────────────────────────────────────────────────────

function resolveStage(intent: WorkflowIntent, slots: WorkflowSlotMap): WorkflowStage {
  if (intent === 'unknown') return 'unknown';

  if (intent === 'plan_holiday') {
    if (!slots.destination) return 'ask_destination';
    if (!slots.holiday_type) return 'ask_holiday_type';

    const travelMissing =
      !slots.travellers || !slots.travel_time || !slots.departure_city || !slots.nights;
    const needsHotelPref = slots.holiday_type === 'personalized' && !slots.hotel_preference;

    if (travelMissing || needsHotelPref) return 'ask_travel_details';

    // Travel details complete — proceed to callback stage directly once the user
    // selects any post-package action. Lead collection is intentionally skipped.
    const hasPostAction = Boolean(slots.post_package_action);
    const hasContactStart = Boolean(slots.name || slots.phone);

    if (hasPostAction || hasContactStart) {
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
    if (hasPostAction || hasContactStart) {
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
    if (hasPostAction || hasContactStart) {
      return slots.callback_time ? 'confirmed' : 'ask_callback';
    }
    return 'show_packages';
  }

  // Other intents: transfer, forex, visa, insurance, mice, booking_status
  return slots.callback_time ? 'confirmed' : 'ask_callback';
}

// ─── public API ─────────────────────────────────────────────────────────────

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

// Returns true when the message looks like the user echoing the quick-reply menu
// (contains all three primary service keywords at once). These messages must be
// skipped when scanning history for a locked intent.
function isMenuRepeatMessage(text: string): boolean {
  const t = normalize(text);
  return (
    (t.includes('plan a holiday') || t.includes('plan holiday')) &&
    (t.includes('flight') || t.includes('flights')) &&
    (t.includes('hotel') || t.includes('hotels'))
  );
}

function findLockedIntentFromHistory(historyMessages: string[]): WorkflowIntent | null {
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const msg = historyMessages[i] || '';
    // A greeting marks the start of a new session — stop scanning here so old
    // session messages cannot bleed their intent into the current session.
    if (isGreetingLike(msg)) break;
    const intent = detectWorkflowIntent(msg);
    if (intent !== 'unknown') return intent;
  }
  return null;
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
  // E.g. if user did Hotels → then switched to "Plan a Holiday", we start
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

  // Lead slots (name, phone, email, callback_time) are parsed from a narrow recent
  // window only — NOT from the full session history. This prevents old-session contact
  // info from bleeding into a fresh enquiry even when session boundaries are fuzzy
  // (e.g. user skips "Hi" and goes straight to a service selection).
  const LEAD_SLOT_KEYS = ['name', 'phone', 'email', 'callback_time'] as const;
  const leadWindow = historyMessages.slice(-5);

  let slots: WorkflowSlotMap = {};
  for (const item of sessionMessages) {
    const parsed = parseGeneralSlots(item, intent, slots);
    // Strip lead slots — re-added below from the narrow window
    const stripped = { ...parsed };
    for (const k of LEAD_SLOT_KEYS) delete stripped[k];
    slots = mergeSlots(slots, stripped);
  }
  // Re-add lead slots from the recent window only
  for (const item of leadWindow) {
    const parsed = parseGeneralSlots(item, intent, slots);
    for (const k of LEAD_SLOT_KEYS) {
      if (parsed[k] && !slots[k]) (slots as Record<string, string>)[k] = parsed[k] as string;
    }
  }
  slots = mergeSlots(slots, parseGeneralSlots(args.userMessage, intent, slots));
  // AI-extracted slot hints are a fallback layer: they only fill still-missing fields
  // and never override slots already captured by deterministic parsing.
  if (args.aiSlots) {
    slots = mergeSlots(slots, args.aiSlots);
  }

  // If "customize" is selected as post_package_action, switch to personalized
  if (slots.post_package_action === 'customize') {
    slots.holiday_type = 'personalized';
  }

  // Stage-aware overrides — applied BEFORE final stage resolution.
  const preStage = resolveStage(intent, slots);

  // show_packages: detect bare number/keyword selections as post_package_action
  // so the flow advances to collect_lead instead of repeating the packages.
  if (preStage === 'show_packages' && !slots.post_package_action) {
    const msg = args.userMessage.trim();
    const msgL = normalize(msg);
    if (/^[123]$/.test(msg) ||
        /\b(budget|premium|luxury|package [123]|option [123]|deal [123])\b/i.test(msg) ||
        /\b(get package|get detail|package detail)\b/i.test(msg) ||
        /\b(itinerary|day wise|day-wise|day by day)\b/i.test(msg)) {
      slots.post_package_action = 'get_details';
    } else if (/\b(customis|customiz|modify|edit plan|change plan)\b/i.test(msgL)) {
      slots.post_package_action = 'customize';
    } else if (/\b(callback|call me|call back|arrange call)\b/i.test(msgL)) {
      slots.post_package_action = 'arrange_callback';
    }
  }

  // Callback fallback: treat the entire short message as callback time when
  // all lead info is collected but callback_time is still missing.
  // Handles freeform responses like "evening tomorrow" or "5 pm on saturday".
  if (preStage === 'ask_callback' && !slots.callback_time) {
    const msg = args.userMessage.trim();
    const msgL = normalize(msg);
    if (msg && msg.length <= 60) {
      const isCallbackActionOnly =
        slots.post_package_action === 'arrange_callback' &&
        /\b(arrange\s*callback|callback|call\s*back|call me)\b/i.test(msgL);
      // Only use whole message if it doesn't look like a new service request
      const looksLikeNewIntent =
        detectWorkflowIntent(msg) !== 'unknown' || isGreetingLike(msg);
      if (!looksLikeNewIntent && !isCallbackActionOnly) {
        slots.callback_time = msg;
      }
    }
  }

  const stage = resolveStage(intent, slots);
  const complete = stage === 'confirmed';
  const leadShouldBeSaved = complete;

  // missingSlots kept for backward compat — list what's still needed
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
  }
  if (!slots.callback_time) missingSlots.push('callback_time');

  return { intent, stage, source, slots, missingSlots, complete, leadShouldBeSaved };
}

// ─── reply builders ──────────────────────────────────────────────────────────

const DESTINATION_TAGLINES: Record<string, string> = {
  thailand: 'perfect for beaches, nightlife & relaxation 😊',
  bali: 'a magical island paradise 🌴',
  kashmir: 'truly paradise on earth ❄️🏔️',
  dubai: 'a world of luxury and adventure 🏙️',
  maldives: 'perfect for beaches and crystal waters 🏖️',
  singapore: 'a vibrant city of culture and food 🌆',
  europe: 'a dream destination for history lovers 🏰',
  kerala: 'God\'s own country 🌿',
  goa: 'India\'s beach paradise 🏖️',
};

function getDestinationTagline(destination: string): string {
  const key = normalize(destination).split(' ')[0];
  return DESTINATION_TAGLINES[key] || 'a wonderful destination 😊';
}

export function buildWorkflowReply(state: WorkflowState): string | null {
  if (state.intent === 'unknown' || state.stage === 'unknown') return null;

  const { stage, slots, intent } = state;

  // ── ask_destination ──
  if (stage === 'ask_destination') {
    return (
      '🌍 Amazing!\n\n' +
      'Which destination are you planning to visit? 😊\n\n' +
      'Example: Dubai, Bali, Kashmir, Thailand'
    );
  }

  // ── ask_holiday_type ──
  if (stage === 'ask_holiday_type') {
    const dest = slots.destination || 'your chosen destination';
    const tagline = getDestinationTagline(dest);
    return (
      `✨ Great choice! ${dest} is ${tagline}\n\n` +
      'How would you like to plan your holiday? 😊\n\n' +
      '🌟 Exclusive Holiday Deals\n' +
      '✨ Personalized Holidays'
    );
  }

  // ── ask_travel_details ──
  if (stage === 'ask_travel_details') {
    if (intent === 'plan_holiday') {
      if (slots.holiday_type === 'personalized') {
        const dest = slots.destination || 'your destination';
        return (
          `✨ Wonderful! Let's create your personalized ${dest} holiday 😊\n\n` +
          'Please share your travel preferences:\n\n' +
          (!slots.travellers ? '👥 Number of Travellers\n' : '') +
          (!slots.travel_time ? '📅 Travel Month or Dates\n' : '') +
          (!slots.departure_city ? '🏙 Departure City\n' : '') +
          (!slots.nights ? '🌃 Number of Nights\n' : '') +
          (!slots.hotel_preference ? '🏨 Hotel Preference (3 / 4 / 5 Star)\n' : '') +
          '\nExample:\n2 Adults, 10th July, Delhi, 5 Nights, 4 Star Hotels'
        );
      }
      // exclusive
      return (
        '✨ Perfect! Please share:\n\n' +
        (!slots.travellers ? '👥 Number of Travellers\n' : '') +
        (!slots.travel_time ? '📅 Travel Month or Dates\n' : '') +
        (!slots.departure_city ? '🏙 Departure City\n' : '') +
        (!slots.nights ? '🌃 Number of Nights\n' : '') +
        '\nExample:\n2 Adults, July, Bangalore, 5 Nights'
      );
    }

    if (intent === 'flights') {
      return (
        '✈️ Sure! Please share:\n\n' +
        (!slots.from_city ? '🛫 From City\n' : '') +
        (!slots.to_city ? '🛬 To City\n' : '') +
        (!slots.travel_time ? '📅 Travel Date\n' : '') +
        (!slots.travellers ? '👥 Number of Travellers\n' : '') +
        '\nExample:\nDelhi to Mumbai, 25th June, 2 Adults'
      );
    }

    if (intent === 'hotels') {
      return (
        '🏨 Amazing! Please share:\n\n' +
        (!slots.destination ? '📍 Destination\n' : '') +
        (!slots.travellers ? '👥 Number of Travellers\n' : '') +
        (!slots.travel_time ? '📅 Travel Month or Dates\n' : '') +
        (!slots.nights ? '🌃 Number of Nights\n' : '') +
        '\nExample:\nDubai, 2 Adults, July, 4 Nights'
      );
    }

    // Other intents
    return (
      '✨ Sure! Please share the following details:\n\n' +
      '👤 Full Name\n📞 Contact Number\n🕒 Preferred Callback Time\n\n' +
      'Example: Sini, +91 9876543210, Tomorrow at 5 PM'
    );
  }

  // ── show_packages — AI generates all package/flight/hotel options ──
  if (stage === 'show_packages') {
    return null;
  }

  // ── collect_lead ──
  if (stage === 'collect_lead') {
    // Lead collection is disabled in the current flow; hand off to AI callback step.
    return null;
  }

  // ── ask_callback ──
  if (stage === 'ask_callback') {
    const name = slots.name ? `, ${slots.name}` : '';
    return (
      `✨ Thank you${name}! Your details have been received successfully 😊\n\n` +
      '✨ Step 2: Callback Collection\n\n' +
      '📞 Please share your preferred callback time\n\n' +
      'Example:\nToday at 5 PM\nTomorrow Morning\n\n' +
      'Once shared, we\'ll confirm your callback ✨'
    );
  }

  // ── confirmed — AI handles both initial confirmation and YES/NO follow-up ──
  if (stage === 'confirmed') {
    return null;
  }

  return null;
}

// ─── intent detection ─────────────────────────────────────────────────────────

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

  // plan_holiday — fuzzy-match "holiday", "package", "tour", "leisure"
  if (
    isDigitSelect('1') ||
    /(^|\s)(svc_1|plan holiday|plan a holiday|holiday package|holiday|leisure|tour package)(\s|$)/.test(joined) ||
    fuzzyAny(text, ['holiday', 'package', 'tour', 'leisure'])
  ) {
    // Explicit digit-1, svc_1, or the phrase "plan a holiday" always wins — even if the
    // message also contains "flights"/"hotels" (e.g. the user echoing the quick-reply menu).
    const explicitPlanHoliday =
      isDigitSelect('1') ||
      /(^|\s)(svc_1|plan a holiday|plan holiday)(\s|$)/.test(text);
    const flightLike = hasFlightKeyword;
    const hotelLike = isDigitSelect('3') || /(^|\s)(svc_3|hotel|hotels|stay|resort)(\s|$)/.test(joined);
    if (explicitPlanHoliday || (!flightLike && !hotelLike)) return 'plan_holiday';
  }

  // flights — strict keyword matching only (avoid false positives like "nights")
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

  // Multi-slot travel data → plan_holiday
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
  return 'unknown';
}

// ─── system prompt helpers ───────────────────────────────────────────────────

export function buildConversationMemoryBlock(args: {
  state: WorkflowState;
  recentUserMessages?: string[];
}): string {
  const recent = (args.recentUserMessages || []).filter(Boolean).slice(-12);
  const slotPairs = Object.entries(args.state.slots || {}).filter(([, v]) => Boolean(v));
  const slotText =
    slotPairs.length > 0
      ? slotPairs.map(([k, v]) => `${k}: ${v}`).join(' | ')
      : 'none yet';
  const recentText =
    recent.length > 0
      ? recent.map((v, i) => `${i + 1}. "${v}"`).join('\n')
      : 'none';

  return [
    '─── CONVERSATION MEMORY (AUTHORITATIVE — follow exactly) ───',
    `Intent  : ${args.state.intent}`,
    `Stage   : ${args.state.stage}`,
    `Collected slots: ${slotText}`,
    `Missing : ${args.state.missingSlots.length ? args.state.missingSlots.join(', ') : 'none — all collected'}`,
    'Recent user messages (oldest → newest):',
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

  // ── per-stage task instructions ─────────────────────────────────────────────
  let task = '';

  if (intent === 'unknown' || stage === 'unknown') {
    task = `The customer's intent is not yet identified. Respond warmly and naturally.
Guidelines:
- Greeting (Hi, Hello, etc.) → warmly greet and show: "How may I assist you today? 😊\n\n1️⃣ Plan a Holiday\n2️⃣ Flights\n3️⃣ Hotels"
- Travel-related question → briefly answer, then show the main menu
- Off-topic question (weather, jokes, math, etc.) → say "That's a bit outside my expertise! I'm here to help plan your trip 😊" and show the menu
- Confused or unclear message → empathize and show the menu
- User says they want to speak to a human → say "Sure! You can reach our team at info@traventions.com or WhatsApp us at +91 XXXXX. Meanwhile, I can help you explore options 😊"
- Profanity or frustration → stay calm, empathize: "I understand your concern. Let me connect you with our team who can help you better."
- Random characters/test messages → respond friendly: "Hello! 😊 I'm Sini, your travel assistant. How can I help you today?"
Always end with the main menu if intent is unclear.`;

  } else if (stage === 'ask_destination') {
    task = `Ask the customer which destination they want to visit.
Ask for the destination ONLY — nothing else yet.`;

  } else if (stage === 'ask_holiday_type') {
    task = `Ask the customer to choose between:
🌟 Exclusive Holiday Deals
✨ Personalized Holidays
Do NOT ask about travel details yet. Only ask for the holiday type.`;

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
    task = `Ask for ONLY these missing travel details: ${missing.length ? missing.join(', ') : 'none — all collected'}.
ALREADY COLLECTED — DO NOT ASK AGAIN: ${collected}.
If the customer asks a travel question (visa, weather, currency, etc.) → briefly answer it, THEN re-ask the missing details in the same reply.
If the customer seems confused or off-topic → gently redirect and re-ask the missing details.`;

  } else if (stage === 'show_packages') {
    if (intent === 'flights') {
      const fromCity = slots?.from_city || 'the departure city';
      const toCity = slots?.to_city || 'the destination';
      const travelTime = slots?.travel_time || 'the travel date';
      const travellers = slots?.travellers || 'the given travellers';
      task = `FLIGHT OPTIONS GENERATION — REQUIRED:
Show 2 flight options from ${fromCity} to ${toCity} on ${travelTime} for ${travellers}.
Format EXACTLY as:
✈️ Option 1: Direct Flight
🛫 [Airline name] | ⏱ [realistic duration] | 💰 ₹[realistic INR price] PP (approx)
✨ Highlights: [departure time range, arrival time, airline]

🔄 Option 2: 1-Stop Flight
🛫 [Airline name] via [hub city] | ⏱ [total duration] | 💰 ₹[lower INR price] PP (approx)
✨ Highlights: cheaper option, [layover duration] layover at [hub]

End with:
Would you like to:
✈️ Get Flight Details  ✏️ Customise Flights  📞 Arrange Callback
Use realistic INR pricing only. Never mention USD or $.`;

    } else if (intent === 'hotels') {
      const dest = slots?.destination || 'the destination';
      const travellers = slots?.travellers || '';
      const travelTime = slots?.travel_time || '';
      const nights = slots?.nights || '';
      const hotelPref = slots?.hotel_preference || '';
      task = `HOTEL OPTIONS GENERATION — REQUIRED:
Show 3 hotel options in ${dest}${travellers ? ` for ${travellers}` : ''}${travelTime ? `, ${travelTime}` : ''}${nights ? `, ${nights} nights` : ''}${hotelPref ? ` (${hotelPref} preferred)` : ''}.
Format EXACTLY as:
🏨 [Hotel Name] | ⭐ [Star Rating] | 💰 ₹[realistic price per night] per night
📍 Location: [area / neighbourhood]
✨ Highlights: [3-4 key amenities or nearby attractions]

(repeat for all 3 hotels)

End with:
Would you like to:
🏨 Get Hotel Details  ✏️ Customise Hotels  📞 Arrange Callback
Use realistic INR pricing only. Never mention USD or $.`;

    } else if (slots?.holiday_type === 'personalized') {
      const dest = slots?.destination || 'the destination';
      const nights = slots?.nights || '5';
      const hotelPref = slots?.hotel_preference || '4 star';
      const travellers = slots?.travellers || '';
      const travelTime = slots?.travel_time || '';
      const departureCity = slots?.departure_city || '';
      task = `PERSONALIZED PACKAGE GENERATION — REQUIRED:
The customer wants a personalized holiday to ${dest} for ${travellers || 'the given travellers'}, ${travelTime || 'on the given dates'}, departing ${departureCity || 'from their city'}, ${nights} nights, ${hotelPref} hotels.
Generate exactly 5 package options named: Classic Explorer, Scenic & Relaxation, Premium Experience, Budget Friendly, Luxury Touch.
Format each as:
🌟 Option [N]: [Name]
🏨 ${hotelPref} Hotels | 🌃 ${nights} Nights / ${String(parseInt(nights, 10) + 1)} Days | 💰 ₹[realistic INR price] PP
✨ Highlights: [5 specific sightseeing/activity highlights for ${dest}]

End with:
✨ Would you like to:
1️⃣ Select an option  📄 Get Day-wise Itinerary  ✏️ Modify This Plan  📞 Arrange Callback
Use realistic INR pricing. Never mention USD or $.`;

    } else {
      // exclusive holiday
      const dest = slots?.destination || 'the destination';
      const nights = slots?.nights || '5';
      const days = String(parseInt(nights, 10) + 1);
      const travellers = slots?.travellers || '';
      const travelTime = slots?.travel_time || '';
      const departureCity = slots?.departure_city || '';
      task = `EXCLUSIVE PACKAGE GENERATION — REQUIRED:
Show 3 exclusive holiday packages for ${dest}${travellers ? ` for ${travellers}` : ''}${travelTime ? `, ${travelTime}` : ''}${departureCity ? `, departing from ${departureCity}` : ''}, ${nights} nights.
Format EXACTLY as:
🌟 Package 1: Budget Deal
🏨 3 Star Hotels | 🌃 ${nights} Nights / ${days} Days | 💰 ₹[realistic INR price] PP
✨ Highlights: [5 specific sightseeing/activity highlights for ${dest}]

✨ Package 2: Premium Deal
🏨 4 Star Hotels | 🌃 ${nights} Nights / ${days} Days | 💰 ₹[realistic INR price] PP
✨ Highlights: [5 specific highlights for ${dest}]

🌟 Package 3: Luxury Experience
🏨 5 Star Hotels | 🌃 ${nights} Nights / ${days} Days | 💰 ₹[realistic INR price] PP
✨ Highlights: [5 specific highlights for ${dest}]

End with:
Would you like to:
📄 Get Package Details  ✏️ Customise Holiday  📞 Arrange Callback
Use realistic INR pricing only. Never mention USD or $.`;
    }

  } else if (stage === 'collect_lead') {
    task = `Lead collection is disabled for this workflow.
Do NOT ask for name, phone, or email.
Instead, ask only for the customer's preferred callback time.`;

  } else if (stage === 'ask_callback') {
    task = `Ask for the customer's preferred callback time only.
Do NOT ask for name, phone, or email in this stage.
Tell them a travel expert will call at that time.`;

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
   → Send EXACTLY this confirmation message (replace placeholders):
   "✨ Perfect${name}! Your callback has been scheduled successfully 😊

📞 Our travel expert will contact you *${callbackTime}* and ${ctx}.

Is there anything else I may assist you with today? 😊"

B) If the last assistant message ALREADY contains "callback has been scheduled":
   → The customer is replying to "Is there anything else?". Handle as follows:
   - If YES or a new travel question → reply: "How may I assist you today? 😊\n\n1️⃣ Plan a Holiday\n2️⃣ Flights\n3️⃣ Hotels"
   - If NO / Thank you / ending → reply with EXACTLY:
"Thank you for your time 😊
We truly appreciate your support.

⭐ Kindly rate your experience with us:
https://www.google.com/search?q=Traventions+India+Pvt+Ltd+Reviews"
Do NOT repeat the callback confirmation. Do NOT ask for details already collected.`;
  }

  // Draft reply as structural guide (optional)
  const draftBlock = (stageDraftReply && stage !== 'show_packages')
    ? `\nSTAGE REPLY STRUCTURE (follow this closely, adapt the wording naturally):\n${stageDraftReply}`
    : '';

  return `
TRAVEL SALES WORKFLOW — FOLLOW STRICTLY:
- Customer intent: ${intentLabel}
- Current stage: ${stageLabel}
- Collected so far: ${collected}
- YOUR TASK FOR THIS REPLY: ${task}
${draftBlock}
FORMATTING RULES (mandatory):
- WhatsApp formatting only: *bold*, _italic_, numbered lists, bullet * lists
- NEVER use markdown links [text](url) — write plain URLs only
- Friendly emojis are encouraged
- INR only for all pricing — never USD or $
- Keep reply concise and on-topic for the current stage
`.trim();
}

export function getGreetingMenuText(customerName?: string | null): string {
  const namePart = customerName ? `, ${customerName}` : '';
  return (
    `Hello${namePart}! 😊\n\n` +
    'How may I assist you today?\n\n' +
    '1️⃣ Plan a Holiday\n' +
    '2️⃣ Flights\n' +
    '3️⃣ Hotels'
  );
}

// buildLeadNotes — creates a summary string for CRM notes field
export function buildLeadNotes(intent: WorkflowIntent, slots: WorkflowSlotMap): string {
  const parts: string[] = [`Source: WhatsApp AI`, `Intent: ${intent.replace('_', ' ')}`];
  if (slots.destination) parts.push(`Destination: ${slots.destination}`);
  if (slots.from_city && slots.to_city) parts.push(`Route: ${slots.from_city} → ${slots.to_city}`);
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
