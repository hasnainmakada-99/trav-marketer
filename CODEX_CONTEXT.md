# Traventions WhatsApp AI Bot — Full Technical Context for Codex

## 1. What This System Is

A WhatsApp travel sales bot for **Traventions** (Indian travel agency).
The bot is named **Sini** and guides customers through a structured conversation flow to collect travel requirements, show packages, collect lead info, schedule a callback, and confirm.

**Stack:**
- Next.js 16 App Router (deployed on Oracle VM, PM2 + Nginx + SSL via sslip.io)
- WhatsApp outbound via **YCloud** (`WHATSAPP_OUTBOUND_MODE=ycloud`)
- **Appwrite** as database (collections: `conversations`, `customers`, `leads`, `business_configs`)
- **OpenAI** (GPT-4) for AI replies and preprocessing

---

## 2. Key Files

| File | Role |
|------|------|
| `travai-marketer/app/api/whatsapp/webhook/route.ts` | Main entry point — receives all WhatsApp messages, orchestrates the pipeline |
| `travai-marketer/lib/whatsapp-workflow.ts` | Structured workflow engine — intent detection, slot parsing, stage resolution, reply builders |
| `travai-marketer/lib/openai.ts` | OpenAI wrapper — `getChatResponse`, `extractCustomerInfo`, `preprocessMessage` |
| `travai-marketer/lib/whatsapp-ycloud.ts` | YCloud API calls — send text, send interactive buttons, typing indicator |
| `travai-marketer/lib/whatsapp-format.ts` | `normalizeToWhatsAppMarkdown()` — converts AI markdown to WhatsApp-safe format |
| `travai-marketer/lib/travel-knowledge.ts` | Loads package data from Appwrite + website crawl for RAG context |
| `travai-marketer/lib/whatsapp-bot-routing.ts` | URL safety, bot policy prompt blocks |

---

## 3. Full Message Pipeline (webhook/route.ts)

```
Incoming WhatsApp message
  │
  ├─ Deduplicate (in-memory + DB messageId check)
  ├─ findOrCreateCustomer (Appwrite customers collection)
  ├─ Save inbound message to conversations collection
  │
  ├─ Non-text (audio/image/video)? → Send friendly nudge, stop
  │
  ├─ hasHumanTakeover()? → AI is silent (staff replied within HUMAN_HANDOVER_MINUTES)
  │
  ├─ preprocessMessage() [OpenAI, 1200ms timeout]
  │     → correctedText (typo-fixed version used for all logic)
  │     → intent classification string
  │
  ├─ isGreetingMessage(correctedText)?
  │     → sendYCloudGreetingExperience() [image + 3 quick-reply buttons]
  │     → Save assistant message, STOP
  │
  ├─ resolveWorkflowState(correctedText, intent, historyUserMessages)
  │     → returns WorkflowState { intent, stage, slots, missingSlots, ... }
  │
  ├─ isQuestionLike(correctedText)? → deterministicReply = null
  │   else buildWorkflowReply(workflowState) → deterministicReply
  │
  ├─ deterministicReply !== null?
  │     → Send it, save to DB, STOP
  │
  └─ AI path:
        loadTravelKnowledgeFast() [RAG — Appwrite packages + website crawl]
        Build system prompt:
          businessConfig.openaiSystemPrompt
          + getWorkflowSystemPromptBlock(intent, stage, slots)
          + buildConversationMemoryBlock(state, recentUserMessages)
          + edge-case handling instructions
          + package knowledge snippets
        getChatResponse(correctedText, systemPrompt, history[-20])
        Send via YCloud, save to DB
```

---

## 4. Workflow Engine (whatsapp-workflow.ts)

### 4a. Types

```typescript
type WorkflowIntent =
  'plan_holiday' | 'flights' | 'hotels' |
  'transfer' | 'forex' | 'visa' | 'insurance' | 'mice' | 'booking_status' | 'unknown';

type WorkflowStage =
  'ask_destination' | 'ask_holiday_type' | 'ask_travel_details' |
  'show_packages' | 'collect_lead' | 'ask_callback' | 'confirmed' | 'unknown';

type WorkflowSlotMap = Partial<Record<
  'destination' | 'from_city' | 'to_city' | 'travel_time' | 'travellers' |
  'departure_city' | 'nights' | 'checkin' | 'checkout' | 'budget_inr' |
  'name' | 'phone' | 'email' | 'callback_time' |
  'holiday_type'       // 'exclusive' | 'personalized'
  'hotel_preference'   // '3 star' | '4 star' | '5 star'
  'post_package_action', // 'get_details' | 'get_itinerary' | 'customize' | 'arrange_callback'
  string
>>;
```

### 4b. resolveWorkflowState() — Main Orchestrator

```typescript
resolveWorkflowState({
  userMessage: string,       // typo-corrected current message
  classifiedIntent?: string, // AI's raw intent classification
  historyMessages?: string[] // ALL user messages from DB (up to 40), oldest→newest
}): WorkflowState
```

**Step 1 — Intent resolution (in priority order):**
```
locked = (isGreetingLike(userMessage) || shouldResetState(userMessage))
           ? null
           : findLockedIntentFromHistory(historyMessages)

canOverrideLocked = !locked || isDirectServiceSelection(userMessage)
resolvedOverride  = selectedIntent ?? (msgIntent !== 'unknown' ? msgIntent : null)

intent =
  canOverrideLocked && resolvedOverride  → resolvedOverride   (Hotels/Flights button overrides old lock)
  locked                                 → locked             (mid-conversation data stays in flow)
  else                                   → msgIntent or 'unknown'
```

**Step 2 — Slot accumulation (session-scoped):**
```
slotStart = findSlotStartIndex(historyMessages, intent)
  → finds last greeting in history (session boundary)
  → within session, finds last explicit service selection for current intent
  → returns the later of these two anchors

sessionMessages = historyMessages.slice(slotStart)
slots = merge(parseGeneralSlots(msg) for msg in sessionMessages)
      + parseGeneralSlots(userMessage)
```

**Why session-scoped:** Without this, old-session messages (travellers, dates, callback, etc.) would pre-fill all slots and the bot would jump straight to lead collection on a fresh "Hotels" or "Plan a Holiday" tap.

**Step 3 — Stage-aware pre-overrides:**
- If `preStage === 'show_packages'` and user sent a bare number / package keyword → inject `post_package_action = 'get_details'`
- If `preStage === 'ask_callback'` and no `callback_time` → treat the whole short message as callback time

**Step 4 — Final stage resolution via `resolveStage(intent, slots)`**

---

### 4c. Stage Flows per Intent

**plan_holiday:**
```
ask_destination   → needs: destination
ask_holiday_type  → needs: holiday_type
ask_travel_details→ needs: travellers, travel_time, departure_city, nights
                    (+ hotel_preference if personalized)
show_packages     → all travel details complete, no post_package_action yet
collect_lead      → post_package_action set OR name/phone given; needs: name, phone, email
ask_callback      → lead complete; needs: callback_time
confirmed         → everything collected
```

**flights:**
```
ask_travel_details → needs: from_city, to_city, travel_time, travellers
show_packages      → all complete
collect_lead       → post_package_action set
ask_callback       → lead complete
confirmed
```

**hotels:**
```
ask_travel_details → needs: destination, travellers, travel_time, nights
show_packages      → all complete
collect_lead       → post_package_action set
ask_callback       → lead complete
confirmed
```

**Other intents (transfer, forex, visa, insurance, mice, booking_status):**
```
collect_lead → needs: name, phone, email
ask_callback → lead complete
confirmed
```

---

### 4d. Deterministic vs AI Replies

`buildWorkflowReply(state)` returns a string for deterministic stages, `null` for AI stages:

| Stage | Reply type |
|-------|-----------|
| `ask_destination` | Deterministic string |
| `ask_holiday_type` | Deterministic string |
| `ask_travel_details` | Deterministic string (lists only missing slots) |
| `show_packages` | **null → AI generates packages** |
| `collect_lead` | Deterministic string |
| `ask_callback` | Deterministic string |
| `confirmed` | **null → AI generates confirmation / handles YES/NO** |
| `unknown` | **null → AI handles greeting/off-topic** |

Also: if `isQuestionLike(correctedText)` is true, `deterministicReply` is forced to `null` so AI can answer the question then re-ask the stage info.

---

### 4e. Intent Detection (detectWorkflowIntent)

Priority order (first match wins):
1. `isDigitSelect('1')` or "plan a holiday" / "plan holiday" → `plan_holiday`
   - Exception: if text also contains flight/hotel keywords AND NOT explicit plan phrase → fall through
2. `isDigitSelect('2')` or flight/airfare → `flights`
3. `isDigitSelect('3')` or hotel/stay/resort → `hotels`
4. Multi-slot travel pattern (destination + travellers) → `plan_holiday`
5. from→to + passengers pattern → `flights`
6. transfer/forex/visa/insurance/mice/booking_status keywords
7. → `unknown`

`autoCorrect()` fixes common typos before detection (holday→holiday, fligths→flights, hotles→hotels, etc.)

`isDigitSelect(n)` only matches when the ENTIRE message is that digit (prevents "2 adults" from matching as "Flights").

---

### 4f. Slot Parsing (parseGeneralSlots)

Extracts from any user message:
- `destination` — "going to X", "trip to X", "holiday to X", or short standalone city name (1-3 words, plan_holiday or hotels context)
- `from_city` / `to_city` — "from X to Y" pattern
- `travel_time` — month name, date expression, keyword-prefixed date
- `travellers` — "N adults [M children]", travellers/pax keyword
- `departure_city` — "departure city: X", "from X" in plan_holiday/hotels
- `nights` — "N nights"
- `checkin` / `checkout` — check-in/check-out keywords
- `budget_inr` — budget/₹ keyword
- `email` — regex
- `phone` — regex
- `name` — "name: X", "my name is X", "I am X"
- `callback_time` — day/time expressions
- `holiday_type` — exclusive/personalized keywords
- `hotel_preference` — 3/4/5 star
- `post_package_action` — itinerary/callback/customize keywords

`tryParseCommaFormat()` handles comma-separated input like "Sini, +91 9876543210, sini@gmail.com" or "2 Adults, July, Bangalore, 5 Nights".

`NON_CITY_WORDS` blocklist prevents service keywords ("hotel", "flights", "callback", etc.) from being misclassified as city names.

---

### 4g. Session Boundaries

**isGreetingLike(msg):** Matches `hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening` (exact match, case-insensitive).

**findLockedIntentFromHistory():** Scans user messages backward. Stops (breaks) at any greeting — so old sessions before "Hi" cannot leak intent into the current session.

**findSlotStartIndex():** 
1. Finds the last greeting → `sessionStart`
2. Within `[sessionStart, end]`, finds last `isDirectServiceSelection` message matching current intent → returns that index
3. Falls back to `sessionStart` if no service selection found

**shouldResetState():** "start over", "reset", "main menu", "go back", "restart", "cancel", "start again", "start fresh", "begin again"

---

### 4h. AI System Prompt Structure (getWorkflowSystemPromptBlock)

For each stage, generates a `task` block telling GPT exactly what to do:

- `unknown` → greet + show menu
- `ask_destination` → ask for destination only
- `ask_holiday_type` → ask for Exclusive or Personalized only
- `ask_travel_details` → list ONLY missing slots (already-collected listed as DO NOT ASK AGAIN)
- `show_packages/flights/hotels` → REQUIRED: generate formatted package/flight/hotel options in exact format with INR pricing
- `collect_lead` → ask for name, phone, email
- `ask_callback` → thank + ask preferred callback time
- `confirmed` → 
  - If last assistant message does NOT have "callback has been scheduled" → send confirmation
  - If it does → handle YES (show menu) / NO (send review link)

---

## 5. Greeting Flow (YCloud Mode)

When user sends "Hi" / "Hello":
1. Bot sends an **interactive card** via YCloud: image header (Sini photo) + body text + 3 quick-reply buttons:
   - `svc_1` → "Plan a Holiday"
   - `svc_2` → "Flights"  
   - `svc_3` → "Hotels"
2. When user taps a button, YCloud delivers the button title as the message text.
3. The workflow resolves `plan_holiday` / `flights` / `hotels` from this text.

---

## 6. Database Collections (Appwrite)

**conversations**
- `teamId`, `customerId`, `phone`, `role` (user/assistant), `message`, `messageType`, `sentBy` (customer/ai/staff), `metaMessageId`, `deliveryStatus`, `createdAt`

**customers**
- `teamId`, `phone`, `name`, `email`, `source`, `createdAt`, `updatedAt`

**leads**
- `teamId`, `phone`, `name`, `email`, `source`, `status`, `notes`, `lastContactedAt`, `createdAt`, `updatedAt`

**business_configs**
- `teamId`, `businessName`, `openaiSystemPrompt`, `whatsappPhoneNumberId`

---

## 7. History Window

- **40 messages fetched** from DB (`Query.limit(40)`, `orderDesc($createdAt)`)
- **Full 40** used for `resolveWorkflowState()` (intent lock + slot accumulation)
- **Last 20** sent to OpenAI as conversation history
- **User-only** messages (filtered by `role === 'user'`) passed as `historyMessages` to workflow engine

---

## 8. Key Invariants / Rules

1. **Greeting always resets locked intent.** `isGreetingLike(userMessage) → locked = null`
2. **Slots are session-scoped.** Only messages from current session (after last greeting + after last service selection) are parsed for slots. Old-session data is ignored.
3. **Deterministic replies skip AI.** If `buildWorkflowReply` returns a non-null string, it is sent directly — OpenAI is not called.
4. **Questions bypass deterministic.** `isQuestionLike()` → force AI path so GPT can answer briefly and re-ask.
5. **Direct service selection overrides locked intent.** "Hotels", "Flights", "Plan a Holiday", "1"/"2"/"3" always override a history-locked intent. Mid-conversation data ("2 Adults, July") does NOT override.
6. **post_package_action gates show_packages→collect_lead.** Bare "1"/"2"/"3", "itinerary", "customize", "callback" at the `show_packages` stage are injected as `post_package_action` before stage re-resolution.
7. **Lead is saved at `confirmed` stage** with full slot notes via `buildLeadNotes()`.
8. **No AI for greetings.** Greeting path is fully deterministic — the interactive card is sent and the function returns before any AI call.
9. **Duplicate suppression.** In-memory dedupe (2 min TTL by message ID or content hash) + DB messageId check + recent-AI-reply check (45s window) prevent duplicate sends.
10. **Human handover.** If staff replied more recently than AI, the bot goes silent for `WA_HUMAN_HANDOVER_MINUTES` (default 15). Disabled in YCloud mode.

---

## 9. Environment Variables

```
WHATSAPP_OUTBOUND_MODE=ycloud
YCLOUD_API_KEY=...
YCLOUD_WHATSAPP_FROM=+91XXXXXXXXXX   # Traventions WhatsApp number
YCLOUD_WEBHOOK_SECRET=...
YCLOUD_ENFORCE_SIGNATURE=true/false
OPENAI_API_KEY=...
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=...
APPWRITE_API_KEY=...
APPWRITE_DATABASE_ID=...
NEXT_PUBLIC_DEFAULT_TEAM_ID=...
NEXT_PUBLIC_APP_URL=https://...      # used to build Sini image URL
WA_GREETING_IMAGE_URL=...            # override Sini image URL
TRAVENTIONS_WEBSITE_URL=...
WA_HUMAN_HANDOVER_MINUTES=15
WA_DISABLE_HUMAN_HANDOVER=false
WA_CLASSIFY_TIMEOUT_MS=1200
WA_KNOWLEDGE_TIMEOUT_MS=1800
WA_TYPING_REFRESH_MS=2200
WA_TYPING_MAX_MS=45000
```

---

## 10. Bot Persona & Brand Rules

- Bot name: **Sini**
- Agency: **Traventions India Pvt Ltd**
- All pricing in **INR only** — never USD or $
- WhatsApp formatting: `*bold*`, `_italic_`, numbered lists, bullet `*` lists
- **No markdown links** `[text](url)` — plain URLs only
- Review link: `https://www.google.com/search?q=Traventions+India+Pvt+Ltd+Reviews`
- Contact: `info@traventions.com`

---

## 11. Conversation Flow (End-to-End Example)

```
User:  Hi
Bot:   [Image card] Hello! How may I assist you today? [Plan a Holiday] [Flights] [Hotels]

User:  [taps] Plan a Holiday
Bot:   Which destination are you planning to visit? Example: Dubai, Bali, Kashmir

User:  Dubai
Bot:   Great choice! Dubai is a world of luxury 🏙️
       How would you like to plan? 🌟 Exclusive Holiday Deals  ✨ Personalized Holidays

User:  Exclusive
Bot:   Please share: 👥 Travellers, 📅 Travel Month, 🏙 Departure City, 🌃 Nights
       Example: 2 Adults, July, Bangalore, 5 Nights

User:  2 Adults, July, Bangalore, 5 Nights
Bot:   [AI] 🌟 Package 1: Budget Deal — 3 Star | 5N/6D | ₹45,000 PP ...
       Would you like: 📄 Get Details  ✏️ Customise  📞 Callback

User:  Get Details
Bot:   ✨ Sure! Please share your details:
       👤 Full Name  📞 Contact Number  📧 Email ID

User:  Sini, +91 9876543210, sini@gmail.com
Bot:   ✨ Thank you, Sini! Please share your preferred callback time.

User:  Tomorrow at 5 PM
Bot:   [AI] ✨ Perfect, Sini! Callback scheduled for Tomorrow at 5 PM.
       Is there anything else I may assist you today? 😊

User:  No thanks
Bot:   [AI] Thank you for your time 😊 ... ⭐ Rate us: https://...
```
