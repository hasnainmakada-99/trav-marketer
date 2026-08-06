export type DestinationProfile = {
  destination: string;
  country: string;
  aliases: string[];
  visa: string;
  bestTime: string;
  flightHours: string;
  nights: string;
  priceMin: number;
  priceMax: number;
  currency: string;
  goodFor: string;
  highlights: string;
  tips?: string;
};

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
const priceRange = (min: number, max: number) =>
  min === max ? inr(min) : `${inr(min)} - ${inr(max)}`;

export const TRAVEL_DESTINATIONS: DestinationProfile[] = [
  {
    destination: 'Dubai',
    country: 'UAE',
    aliases: ['dubai', 'uae', 'abudhabi', 'abu dhabi', 'sharjah', 'middle east'],
    visa: 'eVisa or visa on arrival, typically ~30 days for Indian passport holders',
    bestTime: 'Nov-Mar (pleasant); Apr-Sep is hot summer',
    flightHours: '~3-4h direct from India',
    nights: '4-6 nights',
    priceMin: 28000,
    priceMax: 85000,
    currency: 'AED',
    goodFor: 'honeymoon, family, friends, shopping, theme parks',
    highlights: 'Burj Khalifa, desert safari, Marina, Dubai Mall, Atlantis, IMG Worlds',
    tips: 'Great for short breaks and stopovers; fares spike during New Year and Diwali.',
  },
  {
    destination: 'Thailand',
    country: 'Thailand',
    aliases: ['thailand', 'thai', 'bangkok', 'phuket', 'pattaya', 'krabi', 'samui', 'chiang mai'],
    visa: 'Visa on arrival (15 days) or eVisa; tourist visas up to 60 days',
    bestTime: 'Nov-Mar (dry); May-Oct wetter and cheaper',
    flightHours: '~5h direct from India',
    nights: '4-7 nights',
    priceMin: 30000,
    priceMax: 65000,
    currency: 'THB',
    goodFor: 'Friends, honeymoon, beach + city combos, nightlife',
    highlights: 'Bangkok temples, Phuket & Krabi beaches, Pattaya, Phi Phi islands, street food',
    tips: 'Great combos: Bangkok + Phuket, or Pattaya + Krabi.',
  },
  {
    destination: 'Bali',
    country: 'Indonesia',
    aliases: ['bali', 'indonesia', 'ubud', 'seminyak', 'nusa', 'gili'],
    visa: 'Visa on arrival (30 days)',
    bestTime: 'Apr-Sep (dry); Oct-Mar (wet)',
    flightHours: '~7h via connection',
    nights: '5-7 nights',
    priceMin: 40000,
    priceMax: 75000,
    currency: 'IDR',
    goodFor: 'Honeymoon, couples, culture, surf, wellness',
    highlights: 'Ubud rice terraces, Uluwatu temple, Nusa Penida, Seminyak beaches, waterfall tours',
  },
  {
    destination: 'Maldives',
    country: 'Maldives',
    aliases: ['maldives', 'male', 'malpes', 'maa', 'atoll'],
    visa: 'Visa on arrival (30 days)',
    bestTime: 'Dec-Mar (dry); May-Nov wetter and cheaper',
    flightHours: '~6h + boat or seaplane transfer',
    nights: '4-5 nights',
    priceMin: 60000,
    priceMax: 180000,
    currency: 'MVR / USD',
    goodFor: 'Honeymoon, luxury, snorkeling, couples',
    highlights: 'Overwater villas, house reef snorkeling, dolphin cruises, underwater dining',
  },
  {
    destination: 'Singapore',
    country: 'Singapore',
    aliases: ['singapore', 'singapur', 'sentosa', 'sg'],
    visa: 'eVisa usually required via an authorized agent',
    bestTime: 'Feb-Apr (dry); warm all year',
    flightHours: '~5h direct',
    nights: '3-5 nights',
    priceMin: 45000,
    priceMax: 85000,
    currency: 'SGD',
    goodFor: 'Family, stopovers, shopping',
    highlights: 'Universal Studios, Gardens by the Bay, Marina Bay Sands, Sentosa',
  },
  {
    destination: 'Malaysia',
    country: 'Malaysia',
    aliases: ['malaysia', 'kuala', 'kuala lumpur', 'kl', 'langkawi', 'genting', 'penang', 'malacca'],
    visa: 'Visa-free (30 days) for Indian passports',
    bestTime: 'May-Sep (west); Nov-Mar (east coast & Langkawi)',
    flightHours: '~5h direct',
    nights: '4-6 nights',
    priceMin: 30000,
    priceMax: 55000,
    currency: 'MYR',
    goodFor: 'Family, budget trips, nature',
    highlights: 'Petronas Towers, Langkawi beaches, Genting Highlands, Penang heritage, Batu Caves',
  },
  {
    destination: 'Sri Lanka',
    country: 'Sri Lanka',
    aliases: ['sri lanka', 'srilanka', 'colombo', 'kandy', 'galle', 'ella', 'negombo'],
    visa: 'ETA required (online travel authorization)',
    bestTime: 'Dec-Mar (south coast), May-Sep (hill country)',
    flightHours: '~3.5-4h direct',
    nights: '4-6 nights',
    priceMin: 28000,
    priceMax: 50000,
    currency: 'LKR',
    goodFor: 'Family, wildlife, culture, tea-country escapes',
    highlights: 'Kandy, Ella, Galle Fort, Yala safari, tea plantations, whale watching',
  },
  {
    destination: 'Vietnam',
    country: 'Vietnam',
    aliases: ['vietnam', 'viet nam', 'hanoi', 'ho chi minh', 'saigon', 'da nang', 'nha trang', 'phu quoc'],
    visa: 'eVisa (30 days, single entry)',
    bestTime: 'Feb-Apr (north); May-Aug (south)',
    flightHours: '~5h direct',
    nights: '5-7 nights',
    priceMin: 42000,
    priceMax: 70000,
    currency: 'VND',
    goodFor: 'Culture, food, history, adventure',
    highlights: 'Ha Long Bay cruise, Hanoi old quarter, Ho Chi Minh City, Hoi An lantern town',
  },
  {
    destination: 'Turkey',
    country: 'Turkey',
    aliases: ['turkey', 'turkiye', 'istanbul', 'cappadocia', 'antalya', 'pamukkale', 'goreme'],
    visa: 'eVisa (online, 30 days)',
    bestTime: 'Apr-May & Sep-Oct; Jun-Aug for beaches',
    flightHours: '~6-7h with a connection',
    nights: '6-8 nights',
    priceMin: 68000,
    priceMax: 98000,
    currency: 'TRY / EUR',
    goodFor: 'Honeymoon, history, hot air ballooning, couples',
    highlights: 'Istanbul old city, Cappadocia balloons, Pamukkale, Antalya coast',
  },
  {
    destination: 'Mauritius',
    country: 'Mauritius',
    aliases: ['mauritius', 'mauritious', 'port louis', 'mahe'],
    visa: 'Visa on arrival (60 days) for Indian passports',
    bestTime: 'Nov-Dec; May-Sep cool and dry',
    flightHours: '~5-6h direct',
    nights: '5-7 nights',
    priceMin: 85000,
    priceMax: 140000,
    currency: 'MUR',
    goodFor: 'Honeymoon, luxury beach, couples',
    highlights: 'Le Morne, Trou aux Biches, Port Louis, Ile aux Cerfs, catamaran cruises',
  },
  {
    destination: 'Europe (Schengen)',
    country: 'Schengen',
    aliases: ['europe', 'schengen', 'switzerland', 'swiss', 'zurich', 'interlaken', 'lucerne', 'paris', 'france', 'italy', 'rome', 'venice', 'greece', 'santorini', 'prague', 'austria', 'amsterdam', 'barcelona'],
    visa: 'Schengen visa required (apply 3-6 weeks before travelling)',
    bestTime: 'Jun-Sep outbound; winter for snow',
    flightHours: '~8-9h direct + internal',
    nights: '7-14 nights',
    priceMin: 120000,
    priceMax: 260000,
    currency: 'EUR',
    goodFor: 'Honeymoon, history, luxury, couples',
    highlights: 'Swiss Alps (Jungfraujoch, Lucerne), Paris, Rome & Amalfi, Santorini sunset',
    tips: 'Travel insurance covering about 30,000 EUR is mandatory for the Schengen visa.',
  },
  {
    destination: 'Kashmir',
    country: 'India',
    aliases: ['kashmir', 'srinagar', 'gulmarg', 'pahalgam', 'sonamarg', 'ladakh', 'leh'],
    visa: 'No visa needed; Leh/Ladakh needs an Inner Line Permit',
    bestTime: 'Apr-Oct; Dec-Mar for snow (Gulmarg)',
    flightHours: '2-3h from Delhi + road',
    nights: '5-7 nights',
    priceMin: 18000,
    priceMax: 35000,
    currency: 'INR',
    goodFor: 'Honeymoon, family, snow, houseboats',
    highlights: 'Dal Lake houseboats, Gulmarg gondola, Pahalgam valleys, Sonamarg; Ladakh has Pangong & Nubra',
  },
  {
    destination: 'Kerala',
    country: 'India',
    aliases: ['kerala', 'kochi', 'munnar', 'alleppey', 'kumarakom', 'thekkady', 'kovalam'],
    visa: 'No visa needed (domestic)',
    bestTime: 'Sep-Mar (pleasant); Jun-Sep rains',
    flightHours: '1-2h',
    nights: '4-6 nights',
    priceMin: 18000,
    priceMax: 32000,
    currency: 'INR',
    goodFor: 'Honeymoon, backwaters, family',
    highlights: 'Munnar hills, Alleppey houseboat, Kumarakom, Thekkady',
  },
  {
    destination: 'Goa',
    country: 'India',
    aliases: ['goa', 'panaji', 'panjim', 'nudacl', 'candola'],
    visa: 'No visa needed (domestic)',
    bestTime: 'Nov-Mar; Jun-Sep monsoon',
    flightHours: '~2h',
    nights: '3-5 nights',
    priceMin: 15000,
    priceMax: 28000,
    currency: 'INR',
    goodFor: 'Friends, parties, beaches, water sports',
    highlights: 'North & South beaches, nightlife, water sports, Portuguese forts',
  },
  {
    destination: 'Himachal',
    country: 'India',
    aliases: ['himachal', 'manali', 'shimla', 'dharamshala', 'kasol', 'kullu', 'spiti', 'mcleodganj'],
    visa: 'No visa needed (domestic)',
    bestTime: 'Oct-Jun; Dec-Feb snow',
    flightHours: '~6h road from Delhi (no direct airport at Manali)',
    nights: '4-6 nights',
    priceMin: 14000,
    priceMax: 28000,
    currency: 'INR',
    goodFor: 'Family, adventure, snow, trekking',
    highlights: 'Manali (Solang, Rohtang), Shimla, Dharamshala, Kasol',
  },
  {
    destination: 'Uttarakhand',
    country: 'India',
    aliases: ['uttarakhand', 'nainital', 'mussoorie', 'rishikesh', 'jim corbett', 'corbett', 'haridwar'],
    visa: 'No visa needed (domestic)',
    bestTime: 'Mar-Jun & Sep-Nov',
    flightHours: '~1-1.5h',
    nights: '3-5 nights',
    priceMin: 12000,
    priceMax: 25000,
    currency: 'INR',
    goodFor: 'Nature, adventure, Rishikesh yoga, wildlife',
    highlights: 'Nainital lake, Mussoorie, Rishikesh rafting, Jim Corbett safari',
  },
  {
    destination: 'Rajasthan',
    country: 'India',
    aliases: ['rajasthan', 'jaipur', 'udaipur', 'jodhpur', 'jaisalmer', 'pushkar', 'varuna'],
    visa: 'No visa needed (domestic)',
    bestTime: 'Oct-Mar',
    flightHours: '2-3h to Jaipur',
    nights: '4-6 nights',
    priceMin: 18000,
    priceMax: 34000,
    currency: 'INR',
    goodFor: 'Heritage, family, luxury hotels, culture',
    highlights: 'Jaipur forts, Udaipur lake city, Jodhpur blue city, Jaisalmer desert camp',
  },
  {
    destination: 'Andaman',
    country: 'India',
    aliases: ['andaman', 'port blair', 'havelock', 'neil', 'swaraj'],
    visa: 'No visa needed (domestic)',
    bestTime: 'Oct-May',
    flightHours: '~2-5h via Chennai/Kolkata',
    nights: '4-6 nights',
    priceMin: 24000,
    priceMax: 42000,
    currency: 'INR',
    goodFor: 'Honeymoon, beaches, scuba, nature',
    highlights: 'Havelock & Neil beaches, scuba diving, corals, Cellular Jail',
  },
];

export function findDestination(input: string): DestinationProfile | undefined {
  const t = (input || '').toLowerCase();
  for (const d of TRAVEL_DESTINATIONS) {
    if (t.includes(d.destination.toLowerCase())) {
      return d;
    }
    for (const alias of d.aliases) {
      if (t.includes(alias)) {
        return d;
      }
    }
  }
  return undefined;
}

const CURRENCIES: Array<{ code: string; name: string; approx: string }> = [
  { code: 'USD', name: 'US Dollar', approx: '~₹85-86 per USD' },
  { code: 'EUR', name: 'Euro', approx: '~₹92 per EUR' },
  { code: 'GBP', name: 'British Pound', approx: '~₹107 per GBP' },
  { code: 'AED', name: 'UAE Dirham', approx: '~₹23 per AED' },
  { code: 'THB', name: 'Thai Baht', approx: '~₹2.30 per THB' },
  { code: 'SGD', name: 'Singapore Dollar', approx: '~₹63 per SGD' },
  { code: 'MYR', name: 'Malaysian Ringgit', approx: '~₹19 per MYR' },
  { code: 'LKR', name: 'Sri Lankan Rupee', approx: '~₹2.40 per LKR' },
  { code: 'VND', name: 'Vietnamese Dong', approx: '~₹2.90 per 1000 VND' },
  { code: 'TRY', name: 'Turkish Lira', approx: '~₹23 per TRY' },
  { code: 'IDR', name: 'Indonesian Rupiah', approx: '~₹5.20 per 1000 IDR' },
  { code: 'MVR', name: 'Maldivian Rufiyaa', approx: '~₹55 per MVR' },
  { code: 'MUR', name: 'Mauritian Rupee', approx: '~₹18 per MUR' },
];

export function buildCurrencyPrompt(): string {
  const lines = CURRENCIES.map((c) => `- ${c.code} (${c.name}): ${c.approx}`);
  return `CURRENCY & FOREX (rough indicative rates for budgeting; live rates fluctuate):\n${lines.join(
    '\n'
  )}`;
}

export function buildDestinationKnowledgePrompt(): string {
  const blocks = TRAVEL_DESTINATIONS.map((d) => {
    const parts = [
      `• ${d.destination} (${d.country})`,
      `  - Visa (Indian passport): ${d.visa}`,
      `  - Best time: ${d.bestTime}`,
      `  - Fly from India: ${d.flightHours} | Stay: ${d.nights}`,
      `  - Typical PP package (air+hotel): ${priceRange(d.priceMin, d.priceMax)}`,
      `  - Currency: ${d.currency} | Great for: ${d.goodFor}`,
      `  - Highlights: ${d.highlights}`,
    ];
    if (d.tips) {
      parts.push(`  - Tips: ${d.tips}`);
    }
    return parts.join('\n');
  });

  return `DESTINATION KNOWLEDGE (atomic, structured facts on the popular Traventions destinations — trust these for visa, best time, budget, duration, currency, and highlights; CRM PACKAGE KNOWLEDGE overrides only for specific live package/pricing):
${blocks.join('\n')}`;
}

export function getTrustedPriceTokens(): string[] {
  const tokens = new Set<string>();
  for (const d of TRAVEL_DESTINATIONS) {
    tokens.add(String(d.priceMin));
    tokens.add(String(d.priceMax));
  }
  return Array.from(tokens);
}

export function destinationBudgetHint(destination: string): string | null {
  const profile = findDestination(destination);
  if (!profile) {
    return null;
  }
  return `${profile.destination}: typically ${priceRange(profile.priceMin, profile.priceMax)} per person (all-inclusive air + hotels, varies by season); ${profile.nights} recommended.`;
}

export function visaQuickGuide(): string {
  const lines = TRAVEL_DESTINATIONS.map((d) => `- ${d.destination}: ${d.visa}`);
  return `QUICK VISA REFERENCE (Indian passport) - always reconfirm with the local consulate as policies change:\n${lines.join(
    '\n'
  )}\nTip: Most visa applications take 3-15 working days; Schengen usually needs 3-6 weeks.`;
}