# TravAI Marketer — Complete Setup & Build Guide

This is the complete source code for **TravAI Marketer**, a custom AI-powered Marketing & Communication Platform.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

This will install:
- **Next.js 16** — Frontend framework
- **Appwrite SDK** — Database & backend
- **OpenAI** — AI chatbot engine
- **Tailwind CSS** — Styling

### 2. Set Up Environment Variables

Copy the `.env.local` file template and fill in your credentials:

```bash
# Already included: .env.local
# Update these values from your accounts:

APPWRITE_PROJECT_ID=69ec9b740017562ddc32  # ✓ Done
APPWRITE_API_KEY=standard_3fdd...  # ✓ Done

# Still need:
OPENAI_API_KEY=sk-proj-...  # from platform.openai.com
WHATSAPP_TOKEN=your_token  # from Meta Business Manager
WHATSAPP_PHONE_NUMBER_ID=your_id  # from Meta
GOOGLE_CLIENT_ID=...  # from Google Cloud Console
GOOGLE_CLIENT_SECRET=...
```

### 3. Initialize Appwrite Database

Run the database setup script to create all collections:

```bash
npm run setup-db
```

This will:
- ✓ Create the `travai` database
- ✓ Create 9 collections with full schema
- ✓ Create optimized indexes
- ✓ Set up multi-tenant isolation

**Expected output:**
```
🚀 TravAI Marketer — Appwrite Database Setup

📍 Endpoint: https://cloud.appwrite.io/v1
📍 Project ID: 69ec9b740017562ddc32
📍 Database ID: travai
============================================================

✅ Database setup completed successfully!

📋 Summary:
   ✓ Collections: 9
   ✓ Collections created:
      • Business Configs
      • Customers
      • Conversations
      • Leads
      • Campaigns
      • Campaign Logs
      • GBP Posts
      • GBP Reviews
      • Staff
```

### 4. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` in your browser.

---

## Project Structure

```
travai-marketer/
├── app/
│   ├── (platform)/                    ← Dashboard route group
│   │   ├── layout.tsx                 ← Dashboard shell (sidebar)
│   │   ├── login/page.tsx             ← Login page
│   │   └── dashboard/                 ← Dashboard pages (coming)
│   │       ├── page.tsx               ← Overview
│   │       ├── leads/page.tsx         ← Lead pipeline
│   │       ├── conversations/page.tsx ← Chat inbox
│   │       ├── campaigns/page.tsx     ← Marketing campaigns
│   │       ├── gbp/page.tsx           ← GBP automation
│   │       └── settings/page.tsx      ← Configuration
│   │
│   ├── api/                           ← API routes
│   │   ├── whatsapp/webhook/          ← WhatsApp webhook
│   │   ├── campaigns/send/            ← Campaign sending
│   │   └── gbp/                       ← GBP API routes
│   │
│   ├── page.tsx                       ← Home page
│   ├── layout.tsx                     ← Root layout
│   └── globals.css
│
├── lib/                               ← Utility functions
│   ├── appwrite.ts                    ← Server-side Appwrite
│   ├── appwrite-client.ts             ← Client-side Appwrite
│   ├── whatsapp.ts                    ← WhatsApp helpers
│   └── openai.ts                      ← OpenAI helpers
│
├── components/                        ← React components
│   └── platform/                      ← Dashboard components
│       ├── Sidebar.tsx
│       ├── ChatBubble.tsx
│       ├── LeadCard.tsx
│       └── ...
│
├── scripts/
│   └── setup-database.js              ← Database initialization
│
├── public/                            ← Static assets
├── .env.local                         ← Environment variables (secret!)
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts
└── tailwind.config.ts
```

---

## Database Schema (Appwrite Collections)

All data is stored in Appwrite Cloud. Each collection is optimized for multi-tenancy.

### 1. **business_configs**
Per-client configuration (WhatsApp tokens, AI training, GBP credentials)
- teamId, businessName, businessDescription
- whatsappToken, whatsappPhoneNumberId, whatsappVerifyToken (encrypted)
- openaiSystemPrompt, googleAccessToken, googleRefreshToken

### 2. **customers**
All customer records with contact info
- teamId, phone, name, email, source (whatsapp/missed_call/walk_in)
- tags, totalSpent, lastPurchaseDate, notes

### 3. **conversations**
Chat history (customer ↔ AI messages)
- teamId, customerId, phone, role (user/assistant)
- message, messageType, sentBy, metaMessageId, deliveryStatus

### 4. **leads**
Sales pipeline
- teamId, phone, name, source, status (new/contacted/qualified/converted/lost)
- assignedTo, value, notes, lastContactedAt

### 5. **campaigns**
Marketing campaigns
- teamId, title, type (repeat_purchase/upsell/review_request/reminder/payment)
- templateName, message, segment, status (draft/scheduled/sent/failed)
- scheduledAt, sentAt, totalSent, totalDelivered, totalRead, totalReplied

### 6. **campaign_logs**
Individual campaign delivery tracking
- teamId, campaignId, phone, customerId, status (sent/delivered/read/failed)
- sentAt, deliveredAt, readAt, error

### 7. **gbp_posts**
Google Business Profile posts
- teamId, title, content, googlePostId, status (draft/posted/failed)
- type (auto_generated/manual), createdBy, postedAt

### 8. **gbp_reviews**
Google reviews tracking
- teamId, googleReviewId, reviewer, rating, reviewText
- reply, replyStatus (pending/replied), repliedAt

### 9. **staff**
Team member management
- teamId, userId, name, email, role (owner/admin/manager/staff)
- permissions, status, lastLoginAt

---

## Available Scripts

```bash
# Development
npm run dev           # Start dev server on http://localhost:3000

# Building
npm run build         # Create production build
npm start            # Run production build

# Database
npm run setup-db     # Initialize Appwrite database
npm run setup-db:prod # Setup in production mode

# Code Quality
npm run lint         # Run ESLint
```

---

## Key Utility Files

### `lib/appwrite.ts` — Server-side Appwrite
Used in API routes and server-side operations. Has access to sensitive API keys.

```typescript
import { getDatabaseClient, createDocument, listDocuments } from '@/lib/appwrite';

// Create a customer
const customer = await createDocument('customers', {
  teamId: 'team-123',
  phone: '+91...',
  name: 'John',
  source: 'whatsapp',
});

// List customers
const customers = await listDocuments('customers', [
  `teamId=="team-123"`
]);
```

### `lib/appwrite-client.ts` — Client-side Appwrite
Used in browser components. Has read-only access (filtered by user permissions).

```typescript
import { getAccountClient, subscribeToCollection } from '@/lib/appwrite-client';

// Get current user
const user = await getCurrentUser();

// Subscribe to real-time updates
const unsubscribe = subscribeToCollection('conversations', (data) => {
  console.log('New message:', data);
});
```

### `lib/whatsapp.ts` — WhatsApp API Helper
Send/receive WhatsApp messages and parse webhooks.

```typescript
import { sendWhatsAppMessage, extractMessage } from '@/lib/whatsapp';

// Send message
await sendWhatsAppMessage({
  phoneNumberId: '123456',
  recipientPhone: '+91...',
  message: 'Hello!',
  whatsappToken: 'YOUR_TOKEN',
});

// Parse incoming webhook
const data = parseWhatsAppWebhook(req.body);
const message = extractMessage(data.messages[0]);
```

### `lib/openai.ts` — OpenAI AI Helpers
Generate chatbot responses, campaigns, GBP posts, and more.

```typescript
import { getChatResponse, generateCampaignMessage } from '@/lib/openai';

// Get AI chatbot response
const reply = await getChatResponse(
  userMessage,
  systemPrompt,
  conversationHistory
);

// Generate marketing message
const campaign = await generateCampaignMessage(
  businessContext,
  'repeat_purchase',
  targetAudience
);
```

---

## API Routes (To Be Built)

### `POST /api/whatsapp/webhook`
Receive incoming WhatsApp messages from Meta.
- Verify webhook token
- Extract customer message
- Get/create customer record
- Generate AI response
- Send reply back

### `GET /api/whatsapp/webhook`
Verify webhook (Meta sends hub.challenge).

### `POST /api/campaigns/send`
Send a marketing campaign.
- Get campaign details
- Filter customers by segment
- Send templated messages
- Track delivery

### `GET /api/gbp/connect`
OAuth redirect to Google consent screen.

### `GET /api/gbp/callback`
Handle Google OAuth callback, save tokens.

---

## Environment Variables Checklist

Before you can run the platform, fill in these values:

- [ ] **Appwrite**
  - [x] APPWRITE_ENDPOINT = `https://cloud.appwrite.io/v1`
  - [x] APPWRITE_PROJECT_ID = `69ec9b740017562ddc32`
  - [x] APPWRITE_API_KEY = `standard_3fdd...`
  - [x] APPWRITE_DATABASE_ID = `travai`

- [ ] **OpenAI**
  - [ ] OPENAI_API_KEY (get from https://platform.openai.com/account/api-keys)
  - [x] OPENAI_MODEL = `gpt-4o-mini`

- [ ] **WhatsApp**
  - [ ] WHATSAPP_TOKEN (from Meta Business Manager)
  - [ ] WHATSAPP_PHONE_NUMBER_ID (from Meta)
  - [x] WHATSAPP_VERIFY_TOKEN = `travai-webhook-verify-token-2026`

- [ ] **Google**
  - [ ] GOOGLE_CLIENT_ID (from Google Cloud Console)
  - [ ] GOOGLE_CLIENT_SECRET
  - [x] GOOGLE_REDIRECT_URI = `https://traventions.com/api/gbp/callback`

- [ ] **App URLs**
  - [x] NEXT_PUBLIC_APP_URL = `http://localhost:3000` (change for production)
  - [x] WHATSAPP_WEBHOOK_URL = `http://localhost:3000/api/whatsapp/webhook`

---

## Build Phases

### ✅ Phase 0: Setup (Completed)
- [x] Appwrite project created
- [x] Next.js project initialized
- [x] Database schema defined
- [x] Utility libraries created
- [x] Environment variables set up

### 📝 Phase 1: Core Infrastructure (Days 1-7)
- [ ] WhatsApp webhook implementation
- [ ] AI chatbot integration
- [ ] Dashboard layout
- [ ] Customer/lead management

### 📝 Phase 2: Dashboard & Lead Capture (Days 8-14)
- [ ] Lead pipeline (kanban view)
- [ ] Chat inbox (real-time)
- [ ] Missed call capture
- [ ] Manual lead entry

### 📝 Phase 3: Marketing Campaigns (Days 15-21)
- [ ] Campaign builder
- [ ] Campaign scheduling
- [ ] Analytics dashboard
- [ ] WhatsApp templates

### 📝 Phase 4: GBP & Final Deployment (Days 22-30)
- [ ] Google Business Profile automation
- [ ] Staff/role management
- [ ] Comprehensive testing
- [ ] Client onboarding

---

## Troubleshooting

### Database Setup Fails

**Error: "401 Unauthorized"**
- Your API key is invalid or expired
- Generate a new one: https://cloud.appwrite.io/console/project-[ID]/settings/api-keys

**Error: "404 Not Found - Project"**
- Your PROJECT_ID is wrong
- Check: https://cloud.appwrite.io/console

**Error: "409 Conflict - Collection already exists"**
- Collection already created (safe to ignore)
- Script will skip and continue

### Port Already in Use

If `npm run dev` fails with "port 3000 already in use":

```bash
# Use a different port
npm run dev -- -p 3001
```

### Missing Dependencies

If you see "Cannot find module":

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

---

## Security Best Practices

🔒 **Important:**

1. **Never commit `.env.local`** — It contains secret API keys!
   - Already added to `.gitignore`
   - If accidentally committed, regenerate all keys

2. **Keep API keys secure**
   - Don't share in Slack, email, or public messages
   - Rotate keys regularly
   - Use least-privilege API keys

3. **Use environment variables**
   - Never hardcode API keys in source code
   - Server-side only for sensitive operations

4. **Validate all inputs**
   - Verify webhook tokens
   - Sanitize user messages
   - Rate-limit API endpoints

5. **Encrypt sensitive data**
   - WhatsApp tokens stored encrypted in Appwrite
   - Google tokens encrypted in Appwrite
   - SSL/TLS for all connections

---

## Next Steps

1. **Fill in missing environment variables** (OpenAI, WhatsApp, Google)
2. **Run database setup** — `npm run setup-db`
3. **Start development server** — `npm run dev`
4. **Create Appwrite Teams** — One per client
5. **Build dashboard pages** — Start with login page
6. **Implement WhatsApp webhook** — Connect to AI chatbot
7. **Build campaign system** — Marketing automation
8. **Add GBP automation** — Google Business Profile

---

## Resources

- **Appwrite Docs:** https://appwrite.io/docs
- **Next.js Docs:** https://nextjs.org/docs
- **OpenAI Docs:** https://platform.openai.com/docs
- **WhatsApp Cloud API:** https://developers.facebook.com/docs/whatsapp/cloud-api
- **Google My Business API:** https://developers.google.com/my-business

---

## Support

For questions or issues:
1. Check the troubleshooting section
2. Read the relevant documentation
3. Check Appwrite/OpenAI/Meta console for errors
4. Review the `.env.local` variables

---

**Built with ❤️ by CodeSphere Agency LLP**
