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

function normalize(input: string) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
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
