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
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/i.test(
    msg.trim()
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
  'sini', 'example', 'callback', 'contact',
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

  let travellersAccum: string[] = [];
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

  if (intent === 'plan_holiday' && !existingSlots.departure_city) {
    const cityPart = unclassified.find(safeCityPart);
    if (cityPart) slots.departure_city = cityPart;
  }
  if (intent === 'flights') {
    const cities = unclassified.filter(safeCityPart);
    if (!existingSlots.from_city && cities[0]) slots.from_city = cities[0];
    if (!existingSlots.to_city && cities[1]) slots.to_city = cities[1];
  }

  return slots;
}

function parseGeneralSlots(message: string, intent: WorkflowIntent = 'unknown'): WorkflowSlotMap {
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

  // Short standalone response (1-3 alpha words) is likely a destination when in plan_holiday context
  if (intent === 'plan_holiday' && !slots.destination) {
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
  const commaSlots = tryParseCommaFormat(raw, intent, slots);
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

    // Travel details complete — check if user selected a post-package action
    const hasPostAction = Boolean(slots.post_package_action);
    const hasContactStart = Boolean(slots.name || slots.phone);

    if (hasPostAction || hasContactStart) {
      const hasFullLead = Boolean(slots.name && slots.phone && slots.email);
      if (hasFullLead) {
        return slots.callback_time ? 'confirmed' : 'ask_callback';
      }
      return 'collect_lead';
    }

    return 'show_packages';
  }

  if (intent === 'flights') {
    if (!slots.from_city || !slots.to_city || !slots.travel_time || !slots.travellers) {
      return 'ask_travel_details';
    }
    const hasFullLead = Boolean(slots.name && slots.phone && slots.email);
    if (hasFullLead) {
      return slots.callback_time ? 'confirmed' : 'ask_callback';
    }
    return 'collect_lead';
  }

  if (intent === 'hotels') {
    if (!slots.destination || !slots.travellers || !slots.travel_time || !slots.nights) {
      return 'ask_travel_details';
    }
    const hasFullLead = Boolean(slots.name && slots.phone && slots.email);
    if (hasFullLead) {
      return slots.callback_time ? 'confirmed' : 'ask_callback';
    }
    return 'collect_lead';
  }

  // Other intents: transfer, forex, visa, insurance, mice, booking_status
  const hasFullLead = Boolean(slots.name && slots.phone && slots.email);
  if (hasFullLead) {
    return slots.callback_time ? 'confirmed' : 'ask_callback';
  }
  return 'collect_lead';
}

// ─── public API ─────────────────────────────────────────────────────────────

function shouldResetState(message: string): boolean {
  const text = normalize(message);
  return hasAny(text, ['start over', 'reset', 'new request', 'new enquiry', 'new inquiry']);
}

function findLockedIntentFromHistory(historyMessages: string[]): WorkflowIntent | null {
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const intent = detectWorkflowIntent(historyMessages[i] || '');
    if (intent !== 'unknown') return intent;
  }
  return null;
}

// Returns true only when the message is an explicit, unambiguous service selection
// (button tap, single keyword, or "Plan a Holiday" / "Flights" / "Hotels").
// Used to decide whether the current message can override a locked intent from history.
function isDirectServiceSelection(message: string): boolean {
  const text = normalize(message);
  return /^(plan a holiday|plan holiday|flights?|hotels?|svc_1|svc_2|svc_3|1|2|3)$/.test(text) ||
    /^(visa|transfer|forex|insurance|mice|booking status)$/.test(text);
}

export function resolveWorkflowState(args: {
  userMessage: string;
  classifiedIntent?: string;
  selectedIntent?: WorkflowIntent | null;
  historyMessages?: string[];
}): WorkflowState {
  const historyMessages = args.historyMessages || [];
  const msgIntent = detectWorkflowIntent(args.userMessage, args.classifiedIntent);
  const selected = args.selectedIntent && args.selectedIntent !== 'unknown' ? args.selectedIntent : null;
  const locked = shouldResetState(args.userMessage) ? null : findLockedIntentFromHistory(historyMessages);

  // Locked intent from history wins unless the current message is an explicit,
  // unambiguous service selection (button tap / single keyword).
  // This prevents travel-detail messages like "2 Adults, July, Bangalore, 5 Nights"
  // from accidentally overriding the locked plan_holiday intent.
  const canOverrideLocked = !locked || isDirectServiceSelection(args.userMessage);
  const intent: WorkflowIntent =
    (canOverrideLocked && selected) ? selected
      : locked
        ? locked
        : selected || (msgIntent !== 'unknown' ? msgIntent : 'unknown');
  const source: WorkflowState['source'] = selected && canOverrideLocked
    ? 'selected_now'
    : locked
      ? 'locked_history'
      : 'detected_now';

  if (intent === 'unknown') {
    return { intent, stage: 'unknown', source, slots: {}, missingSlots: [], complete: false, leadShouldBeSaved: false };
  }

  let slots: WorkflowSlotMap = {};
  for (const item of historyMessages) {
    slots = mergeSlots(slots, parseGeneralSlots(item, intent));
  }
  slots = mergeSlots(slots, parseGeneralSlots(args.userMessage, intent));

  // If "customize" is selected as post_package_action, switch to personalized
  if (slots.post_package_action === 'customize') {
    slots.holiday_type = 'personalized';
  }

  // Stage-aware callback fallback: if all lead info is collected but callback_time
  // is still missing, treat the current message as the callback time directly.
  // This handles freeform responses like "evening tomorrow" or "5 pm on saturday".
  const preStage = resolveStage(intent, slots);
  if (preStage === 'ask_callback' && !slots.callback_time) {
    const msg = args.userMessage.trim();
    if (msg && msg.length <= 60) {
      // Only use whole message if it doesn't look like a new service request
      const looksLikeNewIntent =
        detectWorkflowIntent(msg) !== 'unknown' || isGreetingLike(msg);
      if (!looksLikeNewIntent) {
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
  if (!slots.name) missingSlots.push('name');
  if (!slots.phone) missingSlots.push('phone');
  if (!slots.email) missingSlots.push('email');
  if (!slots.callback_time) missingSlots.push('callback_time');

  return { intent, stage, source, slots, missingSlots, complete, leadShouldBeSaved };
}

const TRAVENTIONS_WEBSITE =
  (typeof process !== 'undefined' && process.env?.TRAVENTIONS_WEBSITE_URL) ||
  'https://traventions-ai.vercel.app';

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
        (!slots.from_city ? '🛫 Departure City\n' : '') +
        (!slots.to_city ? '🛬 Destination City\n' : '') +
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

  // ── show_packages (exclusive only — personalized handled by AI) ──
  if (stage === 'show_packages') {
    if (intent === 'plan_holiday' && slots.holiday_type !== 'personalized') {
      const dest = slots.destination || 'your destination';
      return (
        '✨ Perfect! I\'ve got your holiday request 😊\n\n' +
        `📍 Destination: ${dest}\n` +
        `👥 Travellers: ${slots.travellers || '-'}\n` +
        `📅 Travel: ${slots.travel_time || '-'}\n` +
        `🏙 Departure City: ${slots.departure_city || '-'}\n` +
        `🌃 Duration: ${slots.nights || '-'} Nights\n\n` +
        'Searching the best holiday packages for you 😊\n\n' +
        `✨ Here are the available exclusive holiday packages:\n\n` +
        `🌐 ${dest} Holiday Packages\n\n` +
        `Website:\nTraventions Holidays — ${TRAVENTIONS_WEBSITE}/holidays\n\n` +
        'Would you like to:\n\n' +
        '📄 Get Package Details\n' +
        '✨ Customize Holiday\n' +
        '📞 Arrange Callback'
      );
    }
    // personalized — return null so caller lets AI generate the 5 options
    return null;
  }

  // ── collect_lead ──
  if (stage === 'collect_lead') {
    const action = slots.post_package_action;
    const context =
      action === 'get_itinerary'
        ? 'the complete day-wise itinerary'
        : action === 'arrange_callback'
          ? 'schedule your callback'
          : 'complete package details';

    return (
      `✨ Sure! To share ${context}, let\'s proceed quickly 😊\n\n` +
      '✨ Step 1: Lead Collection\n\n' +
      'Please share your details:\n\n' +
      '👤 Full Name (as per Passport/Government ID)\n' +
      '📞 Contact Number\n' +
      '📧 Email ID\n\n' +
      'Example:\nSini, +91 9876543210, sini@gmail.com\n\n' +
      'Once shared, we\'ll schedule your callback and provide full details ✨'
    );
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

  // ── confirmed ──
  if (stage === 'confirmed') {
    const name = slots.name ? `, ${slots.name}` : '';
    const callbackTime = slots.callback_time || 'at the earliest';
    const context =
      intent === 'plan_holiday'
        ? 'assist you with complete package details'
        : intent === 'flights'
          ? 'assist you with the best flight options'
          : 'assist you with your travel requirement';

    return (
      `✨ Perfect${name}! Your callback has been scheduled successfully 😊\n\n` +
      `📞 Our travel expert will contact you *${callbackTime}* and ${context}.\n\n` +
      'Looking forward to planning your holiday ✨'
    );
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

  // plan_holiday — fuzzy-match "holiday", "package", "tour", "leisure"
  if (
    isDigitSelect('1') ||
    /(^|\s)(svc_1|plan holiday|plan a holiday|holiday package|holiday|leisure|tour package)(\s|$)/.test(joined) ||
    fuzzyAny(text, ['holiday', 'package', 'tour', 'leisure'])
  ) {
    // Guard: must not be primarily about flights or hotels to avoid false positives
    const flightLike = fuzzyAny(text, ['flight', 'flights', 'airfare', 'ticket']);
    const hotelLike = isDigitSelect('3') || /(^|\s)(svc_3|hotel|hotels|stay|resort)(\s|$)/.test(joined);
    if (!flightLike && !hotelLike) return 'plan_holiday';
  }

  // flights — fuzzy-match "flights", "flight", "airfare"
  if (
    isDigitSelect('2') ||
    /(^|\s)(svc_2|flight|flights|air ticket|airfare)(\s|$)/.test(joined) ||
    fuzzyAny(text, ['flights', 'flight', 'airfare'])
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
  const recent = (args.recentUserMessages || []).filter(Boolean).slice(-6);
  const slotPairs = Object.entries(args.state.slots || {}).filter(([, v]) => Boolean(v));
  const slotText =
    slotPairs.length > 0
      ? slotPairs.map(([k, v]) => `${k}=${v}`).join(', ')
      : 'none';
  const recentText =
    recent.length > 0
      ? recent.map((v, i) => `${i + 1}. ${v}`).join('\n')
      : 'none';

  return [
    'CONVERSATION MEMORY (must be respected):',
    `- Active workflow: ${args.state.intent}`,
    `- Current stage: ${args.state.stage}`,
    `- Captured user details: ${slotText}`,
    `- Missing details: ${args.state.missingSlots.length ? args.state.missingSlots.join(', ') : 'none'}`,
    '- Recent user messages:',
    recentText,
    '- Do not ask for already captured details again unless user explicitly edits them.',
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

  if (stage === 'ask_destination') {
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
ALREADY COLLECTED — DO NOT ASK AGAIN: ${collected}.`;

  } else if (stage === 'show_packages') {
    if (slots?.holiday_type === 'personalized') {
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
      task = `Show the available exclusive holiday packages for ${slots?.destination || 'the destination'}.
Include destination, travellers, travel dates, departure city, and nights as a summary.
Then show the website link for packages and ask if they want: Package Details, Customize Holiday, or Arrange Callback.`;
    }

  } else if (stage === 'collect_lead') {
    task = `Ask the customer for their Full Name, Phone Number, and Email ID.
All 3 must be collected. Ask in a friendly single message with an example format.
Do NOT ask for travel details — those are already collected.`;

  } else if (stage === 'ask_callback') {
    task = `Thank the customer for sharing their details and ask for their preferred callback time.
Tell them a travel expert will call at that time.
Already have: name=${slots?.name || '?'}, phone=${slots?.phone || '?'}, email=${slots?.email || '?'}.`;

  } else if (stage === 'confirmed') {
    task = `Confirm the callback is scheduled. Thank the customer warmly.
Callback time: ${slots?.callback_time || 'at the earliest'}. Travel expert will reach out.
Close the conversation with warm, encouraging words.`;
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
  const namePart = customerName ? ` ${customerName}` : '';
  return (
    `Welcome to Traventions!${namePart}\n\n` +
    "I'm Sini, your Trav-AI Buddy.\n" +
    'Please choose a service:\n' +
    '1. Plan a Holiday\n' +
    '2. Flights\n' +
    '3. Hotels\n\n' +
    'For Transfer, Forex, Visa, Insurance, MICE, or Booking Status, type the service name directly.'
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
