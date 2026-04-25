# TravAI Marketer — Complete Platform Context

> **Purpose of this file:** Full context document for any new chat session. Contains everything about this project — business context, quotation details, full technical architecture, database schema, API design, build plan, and integration strategy. Read this entire file before answering any questions.

---

## 1. Who We Are

**Company:** CodeSphere Agency LLP  
**Owner/Developer:** Hasnainmakada-99  
**Agency Website:** Traventions (Next.js — existing live website)  
**GitHub Repo:** `hasnainmakada-99/travai-marketer` (currently only has the quotation HTML)

---

## 2. What We Are Building

A **custom AI Marketing & Communication Platform** — a Grexa AI equivalent but fully custom-built, white-labelled, and multi-tenant. It will be integrated into the existing **Traventions Next.js website** as a sub-section (`/dashboard`).

The platform is sold to small/medium businesses as a service. First client is currently being onboarded via quotation **QTN-2026-001**.

### What It Does
- AI chatbot on WhatsApp that talks to the client's customers 24/7
- Lead capture from WhatsApp, missed calls, and walk-ins
- CRM dashboard with lead pipeline, revenue analytics, chat inbox
- Promotional marketing campaigns over WhatsApp (with scheduling)
- Google Business Profile automation (SEO posts, review replies)
- All data synced to Appwrite in real-time

---

## 3. Quotation Details (QTN-2026-001)

| Field | Value |
|---|---|
| Quotation No. | QTN-2026-001 |
| Date | 30 March 2026 |
| Valid Until | 30 April 2026 |
| Total Price | ₹43,500 (one-time, GST included) |
| Payment | 50% advance (₹21,750) + 50% on delivery (₹21,750) |
| Maintenance | 15 months free post-delivery |
| Build Timeline | ~6–8 weeks |

### Pricing vs Grexa AI
- Grexa AI: ₹15,000/quarter → ₹60,000/year + 18% GST = **₹70,800/year recurring**
- Our plan: **₹43,500 one-time** + 15 months free maintenance
- Client saves ₹27,300+ in the first year alone
- After 15 months: optional maintenance plans at ₹15,000/year (Basic) or ₹20,000/year (Standard)

### What's Included in ₹43,500
- Complete platform build (all 5 AI agents + dashboard)
- AI training on client's business (services, pricing, FAQs, tone)
- 15 months free maintenance (bug fixes, updates, monitoring)
- Appwrite Cloud hosting (covered by us)
- WhatsApp number setup and connection
- ₹500 WhatsApp credit to get started

### Running Costs (Paid by Client Directly, NOT to Us)
- WhatsApp Business API (Meta official rates):
  - Service conversations (customer messages first): **FREE**
  - Marketing campaigns (you message first): ₹0.77/conversation
  - Utility/reminders (you message first): ₹0.34/conversation
- AI/GPT processing: actual OpenAI rates, no markup
- Typical monthly cost for 100 daily users: ~₹610/month
- Typical monthly cost for 500 daily users: ~₹3,050/month

---

## 4. The 5 AI Agents

### Agent 1 — WhatsApp Chat AI Agent
**Purpose:** 24/7 AI chatbot trained exclusively on the client's business

Features:
- Exclusively trained on client's services, pricing, testimonials
- Handles unlimited conversations simultaneously
- Handles multiple queries in one conversation
- Knows customer purchase history (from Appwrite DB)
- Human-like, natural conversations
- Multilingual — English, Hindi, Marathi + 9 more languages
- Instant replies — no customer kept waiting
- Auto-creates lead record for every new phone number

### Agent 2 — Lead Conversion AI Agent
**Purpose:** Captures every lead, follows up automatically, never loses a prospect

Features:
- Customer calls from Google Business Profile → if missed → AI instantly sends WhatsApp message
- "We missed your call — ask your query here on WhatsApp!" → AI takes over
- Caller's number auto-saved as lead in CRM
- Works with client's existing phone number
- Captures leads from WhatsApp, missed calls, and walk-ins
- Auto follow-ups for unresponsive leads
- Shares brochures, product info, testimonials automatically
- Lead performance tracking and conversion metrics

### Agent 3 — Promotional Marketing AI Agent
**Purpose:** Drives repeat sales, reviews, and customer retention on autopilot

Features:
- Repeat purchase reminders
- Follow-up visit reminders
- Discount and promotional offer campaigns
- Upselling and cross-selling campaigns
- Pending payment reminders
- Google review request automation
- Membership renewal reminders
- Campaign analytics and conversion tracking

### Agent 4 — AI CRM & Revenue Dashboard
**Purpose:** Full business intelligence, all data in one place

Features:
- Revenue dashboard with real-time insights
- Customer purchase history and sales reports
- Lead pipeline (New → Contacted → Qualified → Converted → Lost)
- Chat inbox (WhatsApp Web-style interface with Appwrite Realtime)
- Communication history and chat logs
- Invoice sharing via WhatsApp
- Multi-role staff access: Owner, Admin, Manager, Staff (Appwrite Teams)
- Real-time notifications via Appwrite Realtime (WebSockets)

### Agent 5 — Google Business Profile AI Agent
**Purpose:** Gets more free leads from Google — more walk-ins, calls, WhatsApp enquiries

Features:
- Finds right SEO keywords for the client's business
- Rewrites SEO-optimised GBP content, services, and descriptions
- Publishes SEO-powered GBP posts automatically (weekly schedule)
- Creates SEO-powered replies to Google reviews
- Generates Google review requests to paid customers
- Real-time GBP performance data and insights
- Keeps Google Business Profile always active and optimised

**Note:** GBP agent requires client to give Google Business Profile Owner/Manager access. Profile must be verified and owned by the client (not an agency).

---

## 5. What Is NOT Included (Add-Ons)

| Item | Notes |
|---|---|
| Mobile App (App Store/Play Store) | Not needed — dashboard works on mobile browser |
| WhatsApp Green Tick ✅ | We help apply — approval is from Meta |
| Writing business content | Client shares info, we set it up for the AI |

AI Voice Calling and AI Outbound Calling were explicitly removed from scope — client did not want them.

---

## 6. Full Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend + API routes | **Next.js 14** (App Router) | Dashboard UI + all backend routes |
| Backend / Database | **Appwrite Cloud** | Auth, DB, Functions, Realtime, Storage |
| WhatsApp | **Meta Cloud API** (official) | Receive/send WhatsApp messages |
| AI Brain | **OpenAI GPT-4o-mini** | Chatbot responses + content generation |
| GBP Automation | **Google My Business API** | Posts, review replies, analytics |
| Hosting (Frontend) | **Vercel** | Next.js deployment |
| Hosting (Backend) | **Appwrite Cloud** | Free tier sufficient to start |

**No Exotel, no Twilio required** — the client already has their business number. Missed call flow uses a simple call forwarding + webhook approach.

---

## 7. System Architecture

```
traventions.com/               → Agency landing page (Traventions site)
traventions.com/dashboard/     → AI Platform dashboard (new, you're building this)
traventions.com/api/           → All backend API routes

Single Next.js repo (travai-marketer) deployed on Vercel.
```

### Data Flow

```
CUSTOMER ACTIONS                  HOW WE CAPTURE IT                STORED IN
────────────────────────────────────────────────────────────────────────────
Customer messages WhatsApp    →  Meta webhook → /api/whatsapp/webhook  → Appwrite
Customer misses a call        →  Call forward → webhook → WA message   → Appwrite
Staff adds walk-in manually   →  Dashboard "Add Lead" form             → Appwrite
GBP review posted             →  Daily Appwrite Function → GPT reply   → Google

OUTBOUND FLOWS
────────────────────────────────────────────────────────────────────────────
Campaign created in dashboard →  Appwrite Scheduled Function runs  → WhatsApp API
GBP post needed (weekly)      →  Appwrite Scheduled Function runs  → Google API
```

### Multi-Tenant Architecture

One Appwrite project serves all clients. Each client = one Appwrite Team.

```
Appwrite Project: travai-platform
│
├── Team: client-abc-fitness         ← first client
│   ├── Members: owner, admin, staff
│   └── All DB documents tagged with teamId: "abc-fitness"
│
├── Team: client-xyz-salon           ← second client
│   └── All DB documents tagged with teamId: "xyz-salon"
│
└── Team: codesphere-admin           ← CodeSphere sees all clients
```

Every query MUST filter by `teamId` — never expose one client's data to another.

Per-client WhatsApp credentials stored in Appwrite DB (not in `.env`):
- `whatsappToken` (encrypted)
- `whatsappPhoneNumberId`
- `whatsappVerifyToken`
- `openaiSystemPrompt` (the business-specific AI training)
- `googleRefreshToken` (for GBP)

Single webhook URL `https://traventions.com/api/whatsapp/webhook` serves all clients — routes to correct team by matching `phoneNumberId` in the incoming webhook payload.

---

## 8. Next.js Project Folder Structure

```
travai-marketer/ (or add inside traventions repo)
├── app/
│   ├── (site)/                         ← existing traventions pages
│   │   ├── page.tsx
│   │   └── ...
│   │
│   ├── (platform)/                     ← NEW: route group (no URL prefix)
│   │   ├── layout.tsx                  ← dashboard shell (sidebar + topbar)
│   │   ├── login/page.tsx              ← Appwrite email/password auth
│   │   └── dashboard/
│   │       ├── page.tsx                ← overview stats
│   │       ├── leads/page.tsx          ← lead pipeline (kanban/table)
│   │       ├── conversations/
│   │       │   ├── page.tsx            ← WhatsApp inbox list
│   │       │   └── [phone]/page.tsx    ← individual chat thread
│   │       ├── campaigns/
│   │       │   ├── page.tsx            ← campaign list + analytics
│   │       │   └── new/page.tsx        ← campaign builder
│   │       ├── gbp/page.tsx            ← GBP performance + posts
│   │       └── settings/page.tsx       ← business config + staff
│   │
│   └── api/
│       ├── whatsapp/
│       │   └── webhook/route.ts        ← Meta webhook (GET verify + POST messages)
│       ├── campaigns/
│       │   └── send/route.ts           ← trigger campaign
│       └── gbp/
│           ├── connect/route.ts        ← OAuth redirect to Google
│           └── callback/route.ts       ← OAuth callback, save tokens
│
├── lib/
│   ├── appwrite.ts                     ← server-side Appwrite client (node-appwrite)
│   ├── appwrite-client.ts              ← browser-side Appwrite client (appwrite)
│   ├── whatsapp.ts                     ← sendWhatsAppMessage() helper
│   ├── openai.ts                       ← getChatReply() helper
│   └── auth.ts                         ← getLoggedInUser(), getUserTeam()
│
├── components/
│   └── platform/
│       ├── Sidebar.tsx
│       ├── LeadCard.tsx
│       ├── ChatBubble.tsx
│       └── CampaignBuilder.tsx
│
├── middleware.ts                        ← protect /dashboard routes
└── .env.local
```

---

## 9. Appwrite Database Schema

**Database ID:** `travai`

### Collection: `business_configs`
| Attribute | Type | Notes |
|---|---|---|
| teamId | string | Links to Appwrite Team |
| businessName | string | |
| whatsappToken | string | Encrypted Meta token |
| whatsappPhoneNumberId | string | |
| whatsappVerifyToken | string | Random string for webhook verification |
| openaiSystemPrompt | string | Business-specific AI training text |
| googleAccessToken | string | GBP OAuth access token |
| googleRefreshToken | string | GBP OAuth refresh token |
| googleLocationId | string | GBP location resource name |

### Collection: `customers`
| Attribute | Type | Notes |
|---|---|---|
| teamId | string | |
| phone | string | WhatsApp phone number |
| name | string | Collected by AI during conversation |
| source | string | whatsapp / missed_call / walk_in |
| tags | string[] | e.g. "vip", "repeat_customer" |
| createdAt | datetime | |

### Collection: `conversations`
| Attribute | Type | Notes |
|---|---|---|
| teamId | string | |
| customerId | string | References customers.$id |
| phone | string | Denormalized for quick queries |
| role | string | "user" or "assistant" |
| message | string | Message content |
| createdAt | datetime | |

### Collection: `leads`
| Attribute | Type | Notes |
|---|---|---|
| teamId | string | |
| phone | string | |
| name | string | |
| source | string | whatsapp / missed_call / walk_in / campaign |
| status | string | new / contacted / qualified / converted / lost |
| assignedTo | string | Appwrite user ID of assigned staff |
| notes | string | |
| createdAt | datetime | |

### Collection: `campaigns`
| Attribute | Type | Notes |
|---|---|---|
| teamId | string | |
| title | string | Internal name |
| type | string | repeat_purchase / upsell / review_request / reminder / payment |
| templateName | string | Meta-approved WhatsApp template name |
| message | string | GPT-generated message text |
| segment | string | all / last_purchase_30d / specific_tag |
| status | string | draft / scheduled / sent / failed |
| scheduledAt | datetime | |
| sentAt | datetime | |
| totalSent | integer | |
| totalDelivered | integer | |
| totalReplied | integer | |

### Collection: `campaign_logs`
| Attribute | Type | Notes |
|---|---|---|
| teamId | string | |
| campaignId | string | References campaigns.$id |
| phone | string | |
| status | string | sent / delivered / read / failed |
| sentAt | datetime | |

### Collection: `gbp_posts`
| Attribute | Type | Notes |
|---|---|---|
| teamId | string | |
| content | string | GPT-generated post content |
| googlePostId | string | ID returned by GBP API after posting |
| status | string | draft / posted / failed |
| postedAt | datetime | |

---

## 10. Key API Routes

### `GET /api/whatsapp/webhook`
Meta calls this once to verify the webhook. Returns `hub.challenge` if `hub.verify_token` matches.

### `POST /api/whatsapp/webhook`
Receives all incoming WhatsApp events. Logic:
1. Extract `phoneNumberId` from payload
2. Look up `teamId` from `business_configs` by `phoneNumberId`
3. Extract sender phone + message text
4. Get or create customer in Appwrite
5. Auto-create lead if new customer
6. Fetch last 10 messages from `conversations` for GPT context
7. Call OpenAI with business system prompt + conversation history
8. Save both messages to `conversations`
9. POST reply back to Meta API

### `POST /api/campaigns/send`
Triggered from dashboard to send a campaign immediately (or by Appwrite scheduled function).
1. Get campaign by ID
2. Fetch customers matching segment filter
3. Loop: send WhatsApp template message to each customer
4. Log delivery status per customer in `campaign_logs`
5. Update campaign status to "sent"

### `GET /api/gbp/connect`
Redirects user to Google OAuth consent screen for GBP access.

### `GET /api/gbp/callback`
Receives OAuth tokens, saves `access_token` + `refresh_token` to `business_configs`.

---

## 11. Appwrite Functions (Scheduled/Background Jobs)

### `campaign-scheduler`
- **Trigger:** Every hour (cron: `0 * * * *`)
- Finds campaigns with `status: scheduled` and `scheduledAt <= now`
- Calls `/api/campaigns/send` for each
- Runtime: Node.js 18

### `gbp-review-responder`
- **Trigger:** Daily at 9am (cron: `0 9 * * *`)
- For each team with GBP connected:
  - Fetch unanswered reviews from Google My Business API
  - For each: GPT generates SEO-optimised reply
  - POST reply back to Google API

### `gbp-post-scheduler`
- **Trigger:** Every Monday 10am (cron: `0 10 * * 1`)
- For each team with GBP connected:
  - GPT generates a local SEO post
  - POST to GBP via API
  - Save to `gbp_posts` collection

---

## 12. Environment Variables

```bash
# Appwrite (shared across all clients — multi-tenant)
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_API_KEY=your_server_api_key
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your_project_id

# OpenAI (shared — one key, costs tracked per token)
OPENAI_API_KEY=your_openai_key

# Google OAuth (for GBP)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://traventions.com/api/gbp/callback

# App
NEXT_PUBLIC_APP_URL=https://traventions.com
```

**Per-client WhatsApp credentials** (Meta tokens, phone number IDs) are stored in the `business_configs` Appwrite collection — NOT in `.env`. This allows managing multiple clients without redeployment.

---

## 13. Authentication & Route Protection

Login uses **Appwrite email/password sessions**.

`middleware.ts` protects all `/dashboard` routes:
```typescript
// Redirect unauthenticated users to /login
// Runs on: /dashboard/:path*
```

Role-based access via **Appwrite Teams**:
- `owner` — full access to everything
- `admin` — everything except billing/plan
- `manager` — view all leads, cannot delete
- `staff` — assigned leads only, no campaign creation

---

## 14. WhatsApp Template Messages

**Critical:** When the BUSINESS sends the first message (campaigns, reminders, missed call auto-reply), Meta requires **pre-approved message templates**. Templates must be submitted and approved before campaigns can run.

Submit at: `business.facebook.com/wa/manage/message-templates`

Templates take **24–48 hours** to get approved. Must be submitted on Day 1 of build.

Templates needed (minimum):
1. Missed call auto-reply
2. Repeat purchase reminder
3. Google review request
4. Promotional offer
5. Pending payment reminder
6. Follow-up visit reminder

**Service conversations** (customer messages first → AI replies) are **completely FREE** on Meta. The AI chatbot handling customer queries costs zero in WhatsApp fees.

---

## 15. 4-Week Build Plan

### Week 1 (Days 1–7): Accounts + WhatsApp AI Chatbot Live
- Day 1–2: Create Meta Business App, WhatsApp Cloud API access, OpenAI account, Appwrite project
- Day 3–4: `npx create-next-app@latest travai-marketer`, install packages, deploy blank app to Vercel (need live URL for Meta webhook)
- Day 4: Create Appwrite DB schema (all collections above)
- Day 5–7: Build `/api/whatsapp/webhook` route with GPT integration
- **✅ Milestone: AI chatbot live on WhatsApp**

### Week 2 (Days 8–14): Lead Capture + CRM Dashboard
- Day 8–10: Build dashboard pages — `/dashboard`, `/dashboard/leads`, `/dashboard/conversations`
- Day 11–12: Add Appwrite Realtime to conversations page (live chat inbox updates)
- Day 13–14: Missed call → WhatsApp flow (call forwarding webhook)
- **✅ Milestone: Dashboard live, all lead sources capturing**

### Week 3 (Days 15–21): Promotional Campaigns + Marketing Agent
- Day 15: Submit all WhatsApp templates to Meta for approval (takes 24–48hrs)
- Day 15–17: Build campaign builder UI at `/dashboard/campaigns/new`
- Day 18–19: Build Appwrite Function `campaign-scheduler`
- Day 20–21: Campaign analytics dashboard
- **✅ Milestone: Full marketing automation live**

### Week 4 (Days 22–30): GBP AI + Auth + Final Polish
- Day 22–23: Google Cloud project + My Business API + OAuth flow
- Day 24–25: `gbp-review-responder` Appwrite Function
- Day 26–27: `gbp-post-scheduler` Appwrite Function + GBP page in dashboard
- Day 28–29: Multi-role auth (Appwrite Teams) + middleware + login page
- Day 30: Full testing + client onboarding + Loom walkthrough recording
- **✅ Milestone: Full platform delivered**

---

## 16. npm Packages to Install

```bash
npm install node-appwrite appwrite openai
npm install -D @types/node
```

---

## 17. Key Decisions Already Made

| Decision | Choice | Reason |
|---|---|---|
| Backend | Appwrite Cloud | All-in-one: DB, Auth, Realtime, Functions, Storage |
| WhatsApp | Meta Cloud API (official) | Free, no middleware, direct |
| AI Model | GPT-4o-mini | Cheapest + fast enough for chatbot |
| Hosting | Vercel (Next.js) | Auto-deploys, edge functions, built-in env vars |
| Multi-tenancy | Appwrite Teams | One project, one DB, filter by teamId |
| Per-client credentials | Stored in DB | Not in .env — allows multiple clients without redeployment |
| AI Voice Calling | **REMOVED** | Client explicitly did not want it |
| AI Outbound Calling | **REMOVED** | Client explicitly did not want it |
| Exotel/Twilio | **NOT USED** | Client already has their number, simple call forward |
| Missed call system | Call forwarding + webhook | No extra phone service needed |

---

## 18. Integration with Traventions Website

The platform integrates into the **existing Traventions Next.js site** as a route group `(platform)`:

```
traventions.com/               → Agency homepage (unchanged)
traventions.com/login          → Client login
traventions.com/dashboard/     → AI platform (new)
traventions.com/api/           → All webhooks
```

Use Next.js **Route Groups** `(platform)` so the dashboard has its own layout (sidebar) without affecting the existing agency site layout.

---

## 19. Quotation HTML File

**File:** `Quotation_AI_Marketing_Platform.html`  
**Location:** `C:\Users\hasna\Desktop\CodeSphere Agency LLP\Quotation\`  
**Also in:** `hasnainmakada-99/travai-marketer` GitHub repo

The quotation is a **single self-contained HTML file** with:
- Inline CSS only (no external dependencies except Google Fonts)
- Print-optimised (`@media print`, `.page-break` classes)
- CodeSphere logo inlined as SVG (from `navbar-logo.svg`) — embedded in both header and footer
- `filter: brightness(0) invert(1)` on logo SVG so it renders white on dark navy header
- No JavaScript — purely static/presentational

### Quotation Sections
1. What You Get (executive summary + 5 highlight cards)
2. All 5 AI Agents (feature breakdown cards)
3. Head-to-Head comparison vs Grexa AI
4. Setup & deployment timeline
5. Pricing & plan details
6. WhatsApp Business API running cost calculator (100 to 10,000 daily users)
7. How it works (tech stack: Appwrite, WhatsApp, AI)
8. Payment structure (50/50 split)
9. After 15 months (maintenance plans)
10. Terms & conditions
11. What's not included (add-ons)
12. Accept & get started (signature area)

---

## 20. Checklist Before Starting Development

- [ ] Meta Business account verified at business.facebook.com
- [ ] Meta Developer App created, WhatsApp product enabled
- [ ] Client's WhatsApp Business number added to Meta (requires OTP)
- [ ] `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` saved
- [ ] OpenAI account created at platform.openai.com, billing added
- [ ] `OPENAI_API_KEY` saved
- [ ] Appwrite Cloud project created at cloud.appwrite.io
- [ ] `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` saved
- [ ] Google Cloud project created, My Business API + Business Profile Performance API enabled
- [ ] Google OAuth 2.0 credentials created, redirect URI set
- [ ] Next.js app deployed to Vercel (blank is fine — just need the live URL)
- [ ] Vercel URL added as webhook in Meta Developer Console
- [ ] WhatsApp message templates submitted to Meta for approval (Day 1 — they take 24–48hrs)
- [ ] Client's business info collected: services, pricing, FAQs, testimonials, tone of voice
- [ ] Google Business Profile access invited to developer Google account

---

## 21. Contact Points

- **Quotation valid:** Until 30 April 2026
- **Quotation number:** QTN-2026-001
- **Issued by:** CodeSphere Agency LLP
- **Platform source:** `hasnainmakada-99/travai-marketer` (GitHub)
- **Quotation file:** `Quotation_AI_Marketing_Platform.html`
- **Logo file:** `navbar-logo.svg` (embedded inline in the HTML)
