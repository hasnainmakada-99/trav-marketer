import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';
import PocketBase from 'pocketbase';
import schema from '../pocketbase/schema.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');

for (const candidate of ['.env', '.env.local']) {
  const fullPath = path.join(APP_DIR, candidate);
  if (fs.existsSync(fullPath)) {
    loadDotenv({ path: fullPath, override: false });
  }
}

const baseUrl = (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const email = (process.env.POCKETBASE_SUPERUSER_EMAIL || '').trim();
const password = (process.env.POCKETBASE_SUPERUSER_PASSWORD || '').trim();
const teamId = (process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp').trim();

if (!email || !password) {
  throw new Error('Missing POCKETBASE_SUPERUSER_EMAIL or POCKETBASE_SUPERUSER_PASSWORD');
}

const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);

function buildCollectionBody(collection) {
  return {
    name: collection.name,
    type: collection.type || 'base',
    fields: collection.fields || [],
    indexes: collection.indexes || [],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };
}

async function ensureCollections() {
  const existingCollections = await pb.collections.getFullList();
  const collectionsByName = new Map(
    existingCollections.map((collection) => [collection.name, collection])
  );
  let created = 0;
  for (const collection of schema.collections) {
    if (collectionsByName.has(collection.name)) continue;
    await pb.collections.create(buildCollectionBody(collection));
    created += 1;
    console.log(`created collection ${collection.name}`);
  }
  if (!created) console.log('all schema collections already exist');
}

const now = new Date().toISOString();

const DESTINATIONS = [
  {
    slug: 'dubai',
    name: 'Dubai',
    destination: 'Dubai',
    country: 'UAE',
    category: 'International',
    visa: 'eVisa or visa on arrival, typically ~30 days for Indian passport holders',
    bestTime: 'Nov-Mar (pleasant); Apr-Sep is hot summer',
    currency: 'AED',
    duration: '4-6 nights',
    price: '₹28,000 - ₹85,000 per person',
    goodFor: 'Honeymoon, family, friends, shopping, theme parks',
    highlights:
      'Burj Khalifa, desert safari, Marina, Dubai Mall, Atlantis, IMG Worlds, Dubai Frame, Miracle Garden',
    description:
      "Dubai is Traventions' most popular short-break destination from India. A 3-4 hour direct flight, easy visa on arrival, and luxury hotels make it ideal for long weekends, shopping trips and family holidays. Combine with Abu Dhabi or a desert safari.",
    tags: ['dubai', 'uae', 'middle-east', 'family', 'shopping'],
  },
  {
    slug: 'thailand',
    name: 'Bangkok + Phuket, Thailand',
    destination: 'Thailand',
    country: 'Thailand',
    category: 'International',
    visa: 'Visa on arrival (15 days) or eVisa; tourist visas up to 60 days',
    bestTime: 'Nov-Mar (dry); May-Oct wetter and cheaper',
    currency: 'THB',
    duration: '4-7 nights',
    price: '₹30,000 - ₹65,000 per person',
    goodFor: 'Friends, honeymoon, beach + city combos, nightlife',
    highlights:
      'Bangkok temples, Phuket & Krabi beaches, Pattaya, Phi Phi islands, Chatuchak market, street food tours',
    description:
      'The classic Thailand combo of bustling Bangkok and tropical Phuket. Great value flights and low cost of living make it a favourite first international trip. All-inclusive options including transfers, hotels and sightseeing.',
    tags: ['thailand', 'bangkok', 'phuket', 'beach', 'family'],
  },
  {
    slug: 'bali',
    name: 'Bali, Indonesia',
    destination: 'Bali',
    country: 'Indonesia',
    category: 'International',
    visa: 'Visa on arrival (30 days)',
    bestTime: 'Apr-Sep (dry); Oct-Mar (wet)',
    currency: 'IDR',
    duration: '5-7 nights',
    price: '₹40,000 - ₹75,000 per person',
    goodFor: 'Honeymoon, couples, culture, surf, wellness',
    highlights:
      'Ubud rice terraces, Uluwatu temple, Nusa Penida, Seminyak beaches, waterfall tours, Nusa Dua',
    description:
      "Bali is our best seller for honeymoons and couples. Ubud jungles, Uluwatu cliff temples and Seminyak beaches in one trip. Villa stays and couples dinners included.",
    tags: ['bali', 'indonesia', 'honeymoon', 'culture', 'beach'],
  },
  {
    slug: 'maldives',
    name: 'Maldives',
    destination: 'Maldives',
    country: 'Maldives',
    category: 'International',
    visa: 'Visa on arrival (30 days)',
    bestTime: 'Dec-Mar (dry); May-Nov wetter and cheaper',
    currency: 'MVR / USD',
    duration: '4-5 nights',
    price: '₹60,000 - ₹180,000 per person',
    goodFor: 'Honeymoon, luxury, snorkeling, couples',
    highlights:
      'Overwater villas, house reef snorkeling, dolphin cruises, underwater dining, private sandbanks',
    description:
      'The ultimate honeymoon island escape. Overwater villas, lagoon snorkeling and private cruises. Options range from affordable local islands to five-star luxury resorts.',
    tags: ['maldives', 'honeymoon', 'luxury', 'beach'],
  },
  {
    slug: 'singapore',
    name: 'Singapore',
    destination: 'Singapore',
    country: 'Singapore',
    category: 'International',
    visa: 'eVisa usually required via an authorized agent',
    bestTime: 'Feb-Apr (dry); warm all year',
    currency: 'SGD',
    duration: '3-5 nights',
    price: '₹45,000 - ₹85,000 per person',
    goodFor: 'Family, stopovers, shopping',
    highlights:
      'Universal Studios, Gardens by the Bay, Marina Bay Sands SkyPark, Sentosa Island, Singapore Zoo Night Safari',
    description:
      'A compact, family-friendly city break. Excellent attractions, food and public transport. Often paired with Malaysia or Bali.',
    tags: ['singapore', 'family', 'shopping', 'theme-park'],
  },
  {
    slug: 'sri-lanka',
    name: 'Sri Lanka',
    destination: 'Sri Lanka',
    country: 'Sri Lanka',
    category: 'International',
    visa: 'ETA required (online travel authorization)',
    bestTime: 'Dec-Mar (south coast), May-Sep (hill country)',
    currency: 'LKR',
    duration: '4-6 nights',
    price: '₹28,000 - ₹50,000 per person',
    goodFor: 'Family, wildlife, culture, tea-country escapes',
    highlights: 'Kandy, Ella, Galle Fort, Yala safari, tea plantations, whale watching',
    description:
      'One of the most affordable international getaways from India. The hill country, beaches, and wildlife safaris in a single, compact trip.',
    tags: ['sri-lanka', 'wildlife', 'culture', 'family'],
  },
  {
    slug: 'mauritius',
    name: 'Mauritius',
    destination: 'Mauritius',
    country: 'Mauritius',
    category: 'International',
    visa: 'Visa on arrival (60 days) for Indian passports',
    bestTime: 'Nov-Dec; May-Sep cool and dry',
    currency: 'MUR',
    duration: '5-7 nights',
    price: '₹85,000 - ₹140,000 per person',
    goodFor: 'Honeymoon, luxury beach, couples',
    highlights: 'Le Morne, Trou aux Biches, Port Louis, Ile aux Cerfs, catamaran cruises',
    description:
      'A romantic island escape with a strong Indian cultural connection, world-class beach resorts and easy visa on arrival. Fly and drive in 5-7 nights.',
    tags: ['mauritius', 'honeymoon', 'luxury', 'beach'],
  },
  {
    slug: 'turkey',
    name: 'Turkey',
    destination: 'Turkey',
    country: 'Turkey',
    category: 'International',
    visa: 'eVisa (online, 30 days)',
    bestTime: 'Apr-May & Sep-Oct; Jun-Aug for beaches',
    currency: 'TRY / EUR',
    duration: '6-8 nights',
    price: '₹68,000 - ₹98,000 per person',
    goodFor: 'Honeymoon, history, hot air ballooning, couples',
    highlights:
      'Istanbul old city, Cappadocia balloons, Pamukkale, Antalya coast, Bosphorus cruise',
    description:
      "Europe's most affordable gateway with rich history and the iconic Cappadocia balloon ride. Split between Istanbul, Cappadocia and the Turquoise Coast sea.",
    tags: ['turkey', 'istanbul', 'cappadocia', 'honeymoon', 'history'],
  },
  {
    slug: 'europe',
    name: 'Europe (Schengen)',
    destination: 'Europe (Schengen)',
    country: 'Schengen',
    category: 'International',
    visa: 'Schengen visa required (apply 3-6 weeks before travelling)',
    bestTime: 'Jun-Sep outbound; winter for snow',
    currency: 'EUR',
    duration: '7-14 nights',
    price: '₹1,20,000 - ₹2,60,000 per person',
    goodFor: 'Honeymoon, history, luxury, couples',
    highlights:
      'Swiss Alps (Jungfraujoch, Lucerne), Paris, Rome & Amalfi, Santorini sunset',
    description:
      'Multi-country European itineraries across Switzerland, France, Italy and Greece. Full visa assistance and travel insurance included.',
    tags: ['europe', 'schengen', 'switzerland', 'paris', 'honeymoon'],
  },
  {
    slug: 'kashmir',
    name: 'Kashmir',
    destination: 'Kashmir',
    country: 'India',
    category: 'Domestic',
    visa: 'No visa needed; Leh/Ladakh needs an Inner Line Permit',
    bestTime: 'Apr-Oct; Dec-Mar for snow (Gulmarg)',
    currency: 'INR',
    duration: '5-7 nights',
    price: '₹18,000 - ₹35,000 per person',
    goodFor: 'Honeymoon, family, snow, houseboats',
    highlights:
      'Dal Lake houseboats, Gulmarg gondola, Pahalgam valleys, Sonamarg; Ladakh has Pangong & Nubra',
    description:
      'Paradise on earth. Shikara rides on Dal Lake, Gulmarg snow sports and alpine valleys. Also covering Ladakh with Inner Line permits.',
    tags: ['kashmir', 'srinagar', 'gulmarg', 'honeymoon', 'snow'],
  },
  {
    slug: 'kerala',
    name: 'Kerala',
    destination: 'Kerala',
    country: 'India',
    category: 'Domestic',
    visa: 'No visa needed (domestic)',
    bestTime: 'Sep-Mar (pleasant); Jun-Sep rains',
    currency: 'INR',
    duration: '4-6 nights',
    price: '₹18,000 - ₹32,000 per person',
    goodFor: 'Honeymoon, backwaters, family',
    highlights: 'Munnar hills, Alleppey houseboat, Kumarakom, Thekkady',
    description:
      "God's own country - tea hills of Munnar and the famous Alleppey houseboat cruise.",
    tags: ['kerala', 'munnar', 'alleppey', 'backwaters', 'honeymoon'],
  },
  {
    slug: 'goa',
    name: 'Goa',
    destination: 'Goa',
    country: 'India',
    category: 'Domestic',
    visa: 'No visa needed (domestic)',
    bestTime: 'Oct-Mar; Jun-Sep monsoon',
    currency: 'INR',
    duration: '3-5 nights',
    price: '₹15,000 - ₹28,000 per person',
    goodFor: 'Friends, parties, beaches, water sports',
    highlights: 'North & South beaches, nightlife, water sports, Portuguese forts',
    description:
      'India’s beach playground — beach parties, water sports and heritage forts.',
    tags: ['goa', 'beach', 'friends', 'nightlife'],
  },
  {
    slug: 'himachal',
    name: 'Himachal',
    destination: 'Himachal',
    country: 'India',
    category: 'Domestic',
    visa: 'No visa needed (domestic)',
    bestTime: 'Oct-Jun; Dec-Feb snow',
    currency: 'INR',
    duration: '4-6 nights',
    price: '₹14,000 - ₹28,000 per person',
    goodFor: 'Family, adventure, snow, trekking',
    highlights: 'Manali (Solang, Rohtang), Shimla, Dharamshala, Kasol',
    description:
      "Mountains, snow, rafting and trekking across Himachal's valleys.",
    tags: ['himachal', 'manali', 'shimla', 'adventure'],
  },
  {
    slug: 'uttarakhand',
    name: 'Uttarakhand',
    destination: 'Uttarakhand',
    country: 'India',
    category: 'Domestic',
    visa: 'No visa needed (domestic)',
    bestTime: 'Mar-Jun & Sep-Nov',
    currency: 'INR',
    duration: '3-5 nights',
    price: '₹12,000 - ₹25,000 per person',
    goodFor: 'Nature, adventure, Rishikesh yoga, wildlife',
    highlights: 'Nainital, Mussoorie, Rishikesh rafting, Jim Corbett safari',
    description: 'Lakes, rafting, yoga and wildlife in the Himalayan foothills.',
    tags: ['uttarakhand', 'nainital', 'rishikesh', 'nature'],
  },
  {
    slug: 'rajasthan',
    name: 'Rajasthan',
    destination: 'Rajasthan',
    country: 'India',
    category: 'Domestic',
    visa: 'No visa needed (domestic)',
    bestTime: 'Oct-Mar',
    currency: 'INR',
    duration: '4-6 nights',
    price: '₹18,000 - ₹34,000 per person',
    goodFor: 'Heritage, family, luxury hotels, culture',
    highlights: 'Jaipur forts, Udaipur lake city, Jodhpur blue city, Jaisalmer desert',
    description:
      'The royal state - forts, palaces, lakes and desert camps in a single heritage circuit.',
    tags: ['rajasthan', 'jaipur', 'udaipur', 'heritage'],
  },
  {
    slug: 'andaman',
    name: 'Andaman',
    destination: 'Andaman',
    country: 'India',
    category: 'Domestic',
    visa: 'No visa needed (domestic)',
    bestTime: 'Oct-May',
    currency: 'INR',
    duration: '4-6 nights',
    price: '₹24,000 - ₹42,000 per person',
    goodFor: 'Honeymoon, beaches, scuba, nature',
    highlights: 'Havelock & Neil beaches, scuba diving, corals, Cellular Jail',
    description:
      'Crystal-clear turquoise water and India’s best scuba diving at Havelock and Neil islands.',
    tags: ['andaman', 'havelock', 'scuba', 'honeymoon', 'beach'],
  },
];

const ITINERARIES = [
  {
    slug: 'dubai-family-5n',
    destination: 'Dubai',
    title: '5 Nights Dubai Family Fun Package',
    days: 5,
    nights: 5,
    hotelCategory: '4-5 Star',
    price: '₹55,000 - ₹95,000 per person',
    inclusions:
      'Airfare, accommodation, breakfast, desert safari with BBQ, Burj Khalifa At The Top, Dubai City Tour, all transfers',
    exclusions: 'Visa fees, personal expenses, meals outside plan',
    highlights: 'Burj Khalifa, Desert Safari, Aquaventure, Dubai Creek',
    itinerary:
      'Day 1: Arrival & hotel check-in. Day 2: Dubai City Tour + Dubai Mall & fountain show. Day 3: Desert Safari with BBQ dinner. Day 4: Aquaventure / Dubai Frame / Miracle Garden. Day 5: Checkout & departure.',
    tags: ['dubai', 'family', '4-star', '5-star'],
  },
  {
    slug: 'dubai-romantic-4n',
    destination: 'Dubai',
    title: '4 Nights Romantic Dubai Getaway',
    days: 4,
    nights: 4,
    hotelCategory: '5 Star',
    price: '₹48,000 - ₹90,000 per person',
    highlights: 'Marina views, Atlantis or Palm resort, romantic dinner',
    itinerary:
      'Day 1: Arrival, Marina promenade. Day 2: Atlantis The Palm. Day 3: Desert safari + dinner. Day 4: Checkout & depart.',
    tags: ['dubai', 'honeymoon', '5-star'],
  },
  {
    slug: 'bali-honeymoon-5n',
    destination: 'Bali',
    title: '5 Nights Bali Honeymoon',
    days: 5,
    nights: 5,
    price: '₹68,000 - ₹95,000 per person',
    hotelCategory: '4-5 Star Resorts',
    inclusions:
      'Return flights, Ubud stay, Nusa Dua resort, private pool experiences, honeymoon cake & dinner',
    highlights: 'Ubud rice terraces, Uluwatu fire dance, Seminyak beachside',
    itinerary:
      'Day 1: Arrival, check-in resort. Day 2: Ubud rice terraces & waterfalls. Day 3: Uluwatu temple & sunset dinner. Day 4: Leisure / spa. Day 5: Depart.',
    tags: ['bali', 'honeymoon', 'resort'],
  },
  {
    slug: 'maldives-4n',
    destination: 'Maldives',
    title: '4 Nights Maldives Overwater Villa',
    days: 4,
    nights: 4,
    price: '₹95,000 - ₹2,00,000 per person',
    hotelCategory: '5 Star Resort',
    inclusions:
      'Return flights (Male), seaplane transfer, overwater villa, snorkeling gear, resort credits',
    highlights: 'Overwater villas, dolphin cruise, house reef snorkel',
    tags: ['maldives', 'honeymoon', 'luxury', 'overwater'],
  },
  {
    slug: 'sri-lanka-family-5n',
    destination: 'Sri Lanka',
    title: '5 Nights Sri Lanka Heritage & Safari',
    days: 5,
    nights: 5,
    price: '₹38,000 - ₹65,000 per person',
    highlights: 'Kandy tooth temple, Ella train ride, Yala safari',
    itinerary:
      'Day 1: Arrive Colombo - Negombo. Day 2: Pinnawala - Kandy. Day 3: Nuwara Eliya & Ella. Day 4: Yala Safari. Day 5: Galle & departure.',
    tags: ['sri-lanka', 'family', 'safari', 'kandy'],
  },
  {
    slug: 'kerala-backwaters-4n',
    destination: 'Kerala',
    title: '4 Nights Kerala Backwater & Hill',
    days: 4,
    nights: 4,
    price: '₹25,000 - ₹38,000 per person',
    highlights: 'Munnar, Alleppey houseboat, Kochi',
    itinerary:
      'Day 1: Kochi. Day 2: Drive to Munnar. Day 3: Munnar sightseeing. Day 4: Alleppey houseboat, departure.',
    tags: ['kerala', 'houseboat', 'munnar', 'honeymoon'],
  },
  {
    slug: 'kashmir-paradise-5n',
    destination: 'Kashmir',
    title: '5 Nights Kashmir Paradise (Houseboat + Gulmarg)',
    days: 5,
    nights: 5,
    price: '₹24,000 - ₹38,000 per person',
    highlights: 'Dal Lake houseboat, Gulmarg gondola, Pahalgam',
    tags: ['kashmir', 'houseboat', 'gulmarg', 'honeymoon'],
  },
  {
    slug: 'turkey-7n',
    destination: 'Turkey',
    title: '7 Nights Turkey (Istanbul + Cappadocia)',
    days: 7,
    nights: 7,
    price: '₹95,000 - ₹1,30,000 per person',
    highlights: 'Istanbul, Cappadocia balloon, Pamukkale',
    tags: ['turkey', 'istanbul', 'cappadocia', 'balloon'],
  },
  {
    slug: 'thailand-combo-5n',
    destination: 'Thailand',
    title: '5 Nights Bangkok & Phuket Combo',
    days: 5,
    nights: 5,
    price: '₹45,000 - ₹72,000 per person',
    highlights: 'Bangkok temples, Phuket beaches, Phi Phi islands',
    tags: ['thailand', 'bangkok', 'phuket', 'beach'],
  },
  {
    slug: 'singapore-family-4n',
    destination: 'Singapore',
    title: '4 Nights Singapore Family',
    days: 4,
    nights: 4,
    price: '₹55,000 - ₹85,000 per person',
    highlights: 'Universal Studios, Gardens by the Bay, Sentosa',
    tags: ['singapore', 'family', 'theme-park'],
  },
];

async function main() {
  await pb.collection('_superusers').authWithPassword(email, password);
  await ensureCollections();

  const collectionsToSeed = [
    { name: 'destinations', rows: DESTINATIONS },
    { name: 'itineraries', rows: ITINERARIES },
  ];

  for (const { name, rows } of collectionsToSeed) {
    let created = 0;
    let updated = 0;
    const existing = await pb.collection(name).getFullList({
      filter: `teamId = "${teamId}"`,
    });
    const bySlug = new Map(existing.map((item) => [item.slug, item]));

    for (const row of rows) {
      try {
        const found = bySlug.get(row.slug);
        const payload = { ...row, teamId, isActive: true, updatedAt: now };
        if (found) {
          await pb.collection(name).update(found.id, payload);
          updated += 1;
        } else {
          await pb.collection(name).create({ ...payload, createdAt: now });
          created += 1;
        }
      } catch (error) {
        console.error(`FAILED ${name}/${row.slug}:`, error?.message || error);
      }
    }
    console.log(`${name}: ${rows.length} rows processed, created=${created}, updated=${updated}`);
  }

  for (const name of ['destinations', 'itineraries']) {
    try {
      const all = await pb.collection(name).getFullList({ filter: `teamId = "${teamId}"` });
      console.log(`${name} now has ${all.length} records for team ${teamId}`);
    } catch (error) {
      console.warn(`Could not list ${name}:`, error?.message);
    }
  }
}

main().catch((error) => {
  console.error('[seed-travel-data] failed:', error);
  process.exit(1);
});