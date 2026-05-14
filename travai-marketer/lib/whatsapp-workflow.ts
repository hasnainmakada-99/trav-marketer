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
    | 'callback_time',
    string
  >
>;

export type WorkflowState = {
  intent: WorkflowIntent;
  source: 'locked_history' | 'selected_now' | 'detected_now';
  slots: WorkflowSlotMap;
  missingSlots: string[];
  complete: boolean;
};

function normalize(input: string) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function hasAny(text: string, words: string[]) {
  return words.some((w) => text.includes(w));
}

function pick(regex: RegExp, text: string): string | null {
  const m = text.match(regex);
  if (!m?.[1]) return null;
  return m[1].trim();
}

function parseGeneralSlots(message: string): WorkflowSlotMap {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  const slots: WorkflowSlotMap = {};

  const fromTo = raw.match(/\bfrom\s+([a-zA-Z .'-]+?)\s+to\s+([a-zA-Z .'-]+?)(?:\s|,|$)/i);
  if (fromTo?.[1] && fromTo?.[2]) {
    slots.from_city = fromTo[1].trim();
    slots.to_city = fromTo[2].trim();
  }

  if (!slots.destination) {
    const destination = pick(
      /\b(?:destination|going to|visit|trip to|holiday to|for hotels in)\s*[:\-]?\s*([a-zA-Z .'-]{2,40})/i,
      raw
    );
    if (destination) slots.destination = destination;
  }
  if (!slots.destination && slots.to_city) {
    slots.destination = slots.to_city;
  }

  const travelTime = pick(
    /\b(?:travel month|travel date|travel dates|date|on|in)\s*[:\-]?\s*([a-zA-Z0-9 ,/-]{3,40})/i,
    raw
  );
  if (travelTime) slots.travel_time = travelTime;

  const travellers = pick(
    /\b(?:travellers|travelers|traveller count|traveler count|pax|passengers|adults?)\s*[:\-]?\s*([a-zA-Z0-9 ,/+]{1,30})/i,
    raw
  );
  if (travellers) slots.travellers = travellers;
  if (!slots.travellers) {
    const pax = pick(/\b(\d+)\s*(?:pax|passengers?|adults?)\b/i, raw);
    if (pax) slots.travellers = pax;
  }

  const departure = pick(/\b(?:departure city|departing from)\s*[:\-]?\s*([a-zA-Z .'-]{2,40})/i, raw);
  if (departure) slots.departure_city = departure;
  if (!slots.departure_city && slots.from_city) {
    slots.departure_city = slots.from_city;
  }

  const nights = pick(/\b(\d+)\s*(?:nights?|night stay)\b/i, raw);
  if (nights) slots.nights = nights;

  const checkIn = pick(/\b(?:check[\s-]?in)\s*[:\-]?\s*([a-zA-Z0-9 ,/-]{3,30})/i, raw);
  const checkOut = pick(/\b(?:check[\s-]?out)\s*[:\-]?\s*([a-zA-Z0-9 ,/-]{3,30})/i, raw);
  if (checkIn) slots.checkin = checkIn;
  if (checkOut) slots.checkout = checkOut;

  const budget = pick(/\b(?:budget|approx budget)\s*[:\-]?\s*(?:₹|inr)?\s*([0-9., ]+\s*[kKmM]?)\b/i, raw);
  if (budget) slots.budget_inr = budget.toUpperCase().replace(/\s+/g, ' ');

  const email = pick(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i, text);
  if (email) slots.email = email;
  const phone = pick(/\b(\+?\d[\d\s-]{7,14}\d)\b/, raw);
  if (phone) slots.phone = phone.replace(/\s+/g, '');

  if (!slots.name) {
    const name = pick(/\b(?:name|full name)\s*[:\-]?\s*([a-zA-Z .'-]{2,40})/i, raw);
    if (name) slots.name = name;
  }

  const callback = pick(
    /\b(?:callback|call me|call back|preferred time|time)\s*[:\-]?\s*([a-zA-Z0-9 :/-]{3,35})/i,
    raw
  );
  if (callback) slots.callback_time = callback;

  return slots;
}

function mergeSlots(base: WorkflowSlotMap, next: WorkflowSlotMap): WorkflowSlotMap {
  return { ...base, ...next };
}

function requiredSlots(intent: WorkflowIntent): string[] {
  if (intent === 'plan_holiday') {
    return ['destination', 'travellers', 'travel_time', 'departure_city', 'nights'];
  }
  if (intent === 'flights') {
    return ['from_city', 'to_city', 'travel_time', 'travellers'];
  }
  if (intent === 'hotels') {
    return ['destination', 'travellers', 'travel_time', 'nights'];
  }
  return ['name', 'phone', 'callback_time'];
}

function findLockedIntentFromHistory(historyMessages: string[]): WorkflowIntent | null {
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const intent = detectWorkflowIntent(historyMessages[i] || '');
    if (intent !== 'unknown') return intent;
  }
  return null;
}

function shouldResetState(message: string): boolean {
  const text = normalize(message);
  return hasAny(text, ['start over', 'reset', 'new request', 'new enquiry', 'new inquiry']);
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

  const intent =
    selected || locked || (msgIntent !== 'unknown' ? msgIntent : 'unknown');
  const source: WorkflowState['source'] = selected
    ? 'selected_now'
    : locked
      ? 'locked_history'
      : 'detected_now';

  if (intent === 'unknown') {
    return { intent, source, slots: {}, missingSlots: [], complete: false };
  }

  let slots: WorkflowSlotMap = {};
  for (const item of historyMessages) {
    slots = mergeSlots(slots, parseGeneralSlots(item));
  }
  slots = mergeSlots(slots, parseGeneralSlots(args.userMessage));

  const required = requiredSlots(intent);
  const missing = required.filter((key) => !slots[key as keyof WorkflowSlotMap]);

  return {
    intent,
    source,
    slots,
    missingSlots: missing,
    complete: missing.length === 0,
  };
}

function listMissingPrompt(intent: WorkflowIntent, missing: string[], slots: WorkflowSlotMap): string {
  if (intent === 'plan_holiday') {
    const lines: string[] = ['✨ Perfect! Please share:'];
    if (missing.includes('travellers')) lines.push('👥 Number of Travellers');
    if (missing.includes('travel_time')) lines.push('📅 Travel Month or Dates');
    if (missing.includes('departure_city')) lines.push('🏙 Departure City');
    if (missing.includes('nights')) lines.push('🌃 Number of Nights');
    if (missing.includes('destination')) lines.push('📍 Destination');
    lines.push('');
    lines.push('Example: 2 Adults, July, Bangalore, 4 Nights');
    return lines.join('\n');
  }
  if (intent === 'flights') {
    const lines: string[] = ['✈️ Sure! Please share:'];
    if (missing.includes('from_city')) lines.push('📍 Departure City');
    if (missing.includes('to_city')) lines.push('📍 Destination');
    if (missing.includes('travellers')) lines.push('👥 Number of Travellers');
    if (missing.includes('travel_time')) lines.push('📅 Travel Date');
    lines.push('');
    lines.push('For Example: Bangalore to Dubai, 18 June, 2 Adults, Round Trip');
    return lines.join('\n');
  }
  if (intent === 'hotels') {
    const lines: string[] = ['🏨 Amazing! Please share:'];
    if (missing.includes('destination')) lines.push('📍 Destination');
    if (missing.includes('travellers')) lines.push('👥 Number of Travellers');
    if (missing.includes('travel_time')) lines.push('📅 Travel Month or Dates');
    if (missing.includes('nights')) lines.push('🌃 Number of Nights');
    lines.push('');
    lines.push('Example: Dubai, 2 Adults, July, 4 Nights');
    return lines.join('\n');
  }
  const lines: string[] = ['✨ Sure! Please share the following details to continue:'];
  if (missing.includes('name')) lines.push('👤 Full Name');
  if (missing.includes('phone')) lines.push('📞 Contact Number');
  if (missing.includes('callback_time')) lines.push('🕒 Preferred Callback Time');
  if (missing.includes('email')) lines.push('📧 Email ID');
  lines.push('');
  lines.push('Example: Sini, +91 9876543210, Tomorrow at 5 PM');
  return lines.join('\n');
}

export function buildWorkflowReply(state: WorkflowState): string | null {
  if (state.intent === 'unknown') return null;
  if (!state.complete) {
    return listMissingPrompt(state.intent, state.missingSlots, state.slots);
  }

  if (state.intent === 'plan_holiday') {
    return (
      '✨ Perfect! I’ve got your holiday request:\n\n' +
      `📍 Destination: ${state.slots.destination}\n` +
      `👥 Travellers: ${state.slots.travellers}\n` +
      `📅 Travel: ${state.slots.travel_time}\n` +
      `🏙 Departure City: ${state.slots.departure_city}\n` +
      `🌃 Nights: ${state.slots.nights}\n\n` +
      'Searching the best holiday packages for you 😊'
    );
  }

  if (state.intent === 'flights') {
    return (
      'AI CONFIRMATION\n\n' +
      `🛫 ${state.slots.from_city} → ${state.slots.to_city}\n` +
      `📅 ${state.slots.travel_time}\n` +
      `👥 ${state.slots.travellers}\n\n` +
      '✨ Great! Here are the best available flight options for your trip 😊'
    );
  }

  if (state.intent === 'hotels') {
    return (
      '✨ Great! I’ve got your hotel requirement:\n\n' +
      `📍 Destination: ${state.slots.destination}\n` +
      `👥 Travellers: ${state.slots.travellers}\n` +
      `📅 Travel: ${state.slots.travel_time}\n` +
      `🌃 Nights: ${state.slots.nights}\n\n` +
      'Searching the best hotel options for you 😊'
    );
  }

  return (
    `✨ Thank you${state.slots.name ? `, ${state.slots.name}` : ''}! Your request has been successfully received 😊\n\n` +
    `📞 Contact: ${state.slots.phone}\n` +
    `🕒 Preferred Callback Time: ${state.slots.callback_time}\n\n` +
    'Our support team will contact you shortly.'
  );
}

export function detectWorkflowIntent(message: string, classifiedIntent?: string): WorkflowIntent {
  const text = normalize(message);
  const intentText = normalize(classifiedIntent || '');
  const joined = `${text} ${intentText}`;

  if (
    /(^|\s)(1|svc_1|plan holiday|plan a holiday|holiday package|holiday|leisure|tour package)(\s|$)/.test(
      joined
    )
  ) {
    return 'plan_holiday';
  }
  if (/(^|\s)(2|svc_2|flight|flights|air ticket|airfare)(\s|$)/.test(joined)) {
    return 'flights';
  }
  if (/(^|\s)(3|svc_3|hotel|hotels|stay|resort)(\s|$)/.test(joined)) {
    return 'hotels';
  }
  if (
    /(destination|travel month|travel date|travel dates|budget|package)/.test(joined) &&
    /(travellers|travelers|adults?|pax|nights?)/.test(joined)
  ) {
    return 'plan_holiday';
  }
  if (/\bfrom\b.+\bto\b.+(\bpassengers?\b|\bpax\b|\badults?\b)/.test(joined)) {
    return 'flights';
  }
  if (/(airport transfer|transfer|pickup|drop)/.test(joined)) {
    return 'transfer';
  }
  if (/(forex|currency exchange|money exchange)/.test(joined)) {
    return 'forex';
  }
  if (/(visa|visas)/.test(joined)) {
    return 'visa';
  }
  if (/(insurance|travel insurance)/.test(joined)) {
    return 'insurance';
  }
  if (/(mice|corporate event|meetings incentives conferences exhibitions)/.test(joined)) {
    return 'mice';
  }
  if (/(booking status|status|pnr|reference|booking id)/.test(joined)) {
    return 'booking_status';
  }
  return 'unknown';
}

export function getWorkflowStarterReply(intent: WorkflowIntent): string | null {
  if (intent === 'plan_holiday') {
    return (
      'Great choice. I can help plan your holiday.\n' +
      'Please share:\n' +
      '1. Destination\n' +
      '2. Travel month or dates\n' +
      '3. Number of travellers\n' +
      '4. Approx budget in INR'
    );
  }
  if (intent === 'flights') {
    return (
      'Perfect. I can help with flight options.\n' +
      'Please share:\n' +
      '1. From city\n' +
      '2. To city\n' +
      '3. Travel date(s)\n' +
      '4. Traveller count'
    );
  }
  if (intent === 'hotels') {
    return (
      'Great. I can help with hotel options.\n' +
      'Please share:\n' +
      '1. City\n' +
      '2. Check-in and check-out dates\n' +
      '3. Adults and children\n' +
      '4. Budget per night in INR'
    );
  }
  if (intent === 'transfer') {
    return (
      'Sure, I can help with airport transfer.\n' +
      'Please share pickup city/airport, date, time, and passenger count.'
    );
  }
  if (intent === 'forex') {
    return (
      'Sure, I can help with forex support.\n' +
      'Please share travel destination, travel date, and approximate amount needed.'
    );
  }
  if (intent === 'visa') {
    return (
      'Sure, I can help with visa assistance.\n' +
      'Please share destination country, travel month, and traveller nationality.'
    );
  }
  if (intent === 'insurance') {
    return (
      'Sure, I can help with travel insurance.\n' +
      'Please share destination, travel dates, and traveller count/ages.'
    );
  }
  if (intent === 'mice') {
    return (
      'Sure, I can help with MICE requirements.\n' +
      'Please share city, event dates, approx attendees, and event type.'
    );
  }
  if (intent === 'booking_status') {
    return (
      'Sure, I can help check booking status.\n' +
      'Please share booking reference and registered phone/email.'
    );
  }
  return null;
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

function requiredFieldsText(intent: WorkflowIntent): string {
  if (intent === 'plan_holiday') {
    return 'destination, travel dates or month, travellers, budget INR, holiday type (exclusive deal or personalized).';
  }
  if (intent === 'flights') {
    return 'origin city, destination city, travel date(s), trip type, traveller count.';
  }
  if (intent === 'hotels') {
    return 'city, check-in, check-out, adults/children, room preference, budget per night INR.';
  }
  if (intent === 'transfer') {
    return 'pickup and drop details, date/time, passenger count.';
  }
  if (intent === 'forex') {
    return 'destination country, travel date, amount/currency need.';
  }
  if (intent === 'visa') {
    return 'destination country, nationality, travel month/date.';
  }
  if (intent === 'insurance') {
    return 'destination, travel dates, traveller count/ages.';
  }
  if (intent === 'mice') {
    return 'event city, event dates, attendee count, event type.';
  }
  if (intent === 'booking_status') {
    return 'booking reference and registered phone/email.';
  }
  return 'Clarify which service the customer needs before asking details.';
}

export function getWorkflowSystemPromptBlock(intent: WorkflowIntent): string {
  const intentLabel = intent === 'unknown' ? 'not yet identified' : intent.replace('_', ' ');
  return `
WHATSAPP SALES WORKFLOW MODE:
- Active workflow intent: ${intentLabel}
- Follow this style: short, clear, actionable messages.
- Ask only missing details; do not ask already provided details again.
- Ask in grouped bullets (max 4 points).
- For pricing or budgets, always use INR only.
- If user message is unclear, ask one clarification question.
- When enough details are collected, send a concise "Callback Confirmation" summary in this format:
  *Service:* <service>
  *Name:* <name or "Not provided">
  *Phone:* <phone>
  *Key Details:* <single-line summary>
  *Preferred Callback Time:* <if provided else "Earliest available">
- After confirmation, respond with:
  "Your request has been submitted successfully. Our support team will contact you shortly."
- Never promise instant ticket issuance or guaranteed prices.
- Required details for current intent: ${requiredFieldsText(intent)}
`.trim();
}
