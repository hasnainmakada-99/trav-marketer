# TravAI Marketer — Appwrite Configuration

## Environment Variables

Copy these values and add to your `.env.local` or set them in your terminal before running the setup script.

### CRITICAL — From Your Appwrite Project

```bash
# Appwrite Cloud Endpoint (don't change this)
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1

# Your Appwrite Project ID (from Appwrite Console)
# Find this at: https://cloud.appwrite.io/console
APPWRITE_PROJECT_ID=YOUR_PROJECT_ID_HERE

# Your Appwrite API Key (KEEP THIS SECRET — don't commit to git)
# Generate at: https://cloud.appwrite.io/console/project-[ID]/settings/api-keys
# Provided by user:
APPWRITE_API_KEY=standard_3fdd6fc4b8a1ffbd9c56842fbd82b6c48a0fb610c65784b54b9aebba5676d1d49dbc601bf894037b290579ffd5fd8cca17fb7624718e46e1bb5f9e260e043f01421c3e98dcaa1758141476fe9b7df0f8361a7987b3f7851314388e87f4366ad1283d637475b8a495e3fbf57c9c249db599f4a3c16a53fc9cbe429e5a4ea36094

# Database ID (choose your preferred ID or we'll create "travai")
APPWRITE_DATABASE_ID=travai

# Client-side Appwrite config (for dashboard browser)
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=YOUR_PROJECT_ID_HERE
```

### OpenAI (AI Brain)

```bash
# OpenAI API Key - get from https://platform.openai.com/account/api-keys
OPENAI_API_KEY=sk-proj-your-api-key-here

# Model to use
OPENAI_MODEL=gpt-4o-mini
```

### Meta WhatsApp (Business Communications)

```bash
# Your WhatsApp Business Account Token (from Meta Business Manager)
WHATSAPP_TOKEN=your_whatsapp_token_here

# Your WhatsApp Business Phone Number ID
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here

# Verification token (random string you create for webhook verification)
WHATSAPP_VERIFY_TOKEN=your_random_verify_token_here
```

### Google Business Profile (SEO Automation)

```bash
# Google Cloud OAuth Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret_here

# Redirect URI (where Google sends the user after login)
GOOGLE_REDIRECT_URI=https://traventions.com/api/gbp/callback
```

### Application URLs

```bash
# Your Next.js app URL (where the dashboard is hosted)
NEXT_PUBLIC_APP_URL=http://localhost:3000  # development
# NEXT_PUBLIC_APP_URL=https://traventions.com  # production

# Meta Webhook URL (where Meta sends WhatsApp messages)
WHATSAPP_WEBHOOK_URL=https://traventions.com/api/whatsapp/webhook
```

---

## How to Set Up Environment Variables

### Option 1: Create `.env.local` file (Recommended for Development)

Create a file named `.env.local` in your project root and paste all the variables above with actual values.

```bash
# .env.local
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your_actual_project_id
APPWRITE_API_KEY=your_actual_api_key
# ... rest of variables
```

### Option 2: Set Variables in Terminal (One-time Setup)

**Windows PowerShell:**
```powershell
$env:APPWRITE_ENDPOINT='https://cloud.appwrite.io/v1'
$env:APPWRITE_PROJECT_ID='your_project_id'
$env:APPWRITE_API_KEY='your_api_key'
# Then run: node appwrite-setup.js
```

**Mac/Linux Bash:**
```bash
export APPWRITE_ENDPOINT='https://cloud.appwrite.io/v1'
export APPWRITE_PROJECT_ID='your_project_id'
export APPWRITE_API_KEY='your_api_key'
# Then run: node appwrite-setup.js
```

### Option 3: Use dotenv Package (Alternative)

Already included in package.json. Just create `.env.local` and variables auto-load.

---

## Running the Setup Script

```bash
# 1. Install dependencies
npm install

# 2. Set up environment (see options above)
# Then run:

npm run setup
```

---

## What the Setup Script Creates

The script automatically creates:

### 9 Collections with Full Schema:

1. **business_configs** — Per-client configuration
   - WhatsApp tokens (encrypted)
   - Google credentials (encrypted)
   - AI training prompts
   - GBP settings

2. **customers** — All customer records
   - Phone, email, name, tags
   - Source tracking (WhatsApp, missed call, walk-in)
   - Purchase history

3. **conversations** — Chat history
   - Customer ↔ AI messages
   - Message type, delivery status
   - Meta API message IDs

4. **leads** — Sales pipeline
   - Statuses: new, contacted, qualified, converted, lost
   - Assignment, value, notes
   - Last contact tracking

5. **campaigns** — Marketing campaigns
   - Types: repeat purchase, upsell, review request, reminder, payment
   - Segments: all, last 30 days, specific tag
   - Scheduling, delivery tracking

6. **campaign_logs** — Individual delivery logs
   - Per-customer delivery tracking
   - Status: sent, delivered, read, failed
   - Error tracking

7. **gbp_posts** — Google Business Profile posts
   - Auto-generated and manual posts
   - Draft, posted, failed status
   - Creation tracking

8. **gbp_reviews** — Google reviews tracking
   - Reviews with ratings
   - AI-generated replies
   - Reply status tracking

9. **staff** — Team member management
   - Roles: owner, admin, manager, staff
   - Permissions, status
   - Login tracking

### Indexes for Performance

Every collection has optimized indexes for fast queries:
- Multi-field indexes on frequently filtered columns
- teamId index (for multi-tenancy isolation)
- Status-based indexes (for pipeline views)

### Permissions & Security

All collections are configured with:
- Multi-tenant isolation (teamId filtering)
- Sensitive data encryption (whatsappToken, googleTokens)
- User-based access control (Appwrite Teams integration)

---

## Verification

After running the setup script, verify everything in Appwrite Console:

1. Go to https://cloud.appwrite.io/console
2. Select your project
3. Click "Databases" → "travai"
4. You should see all 9 collections with their attributes and indexes

---

## Next Steps

1. ✅ **Database Setup Complete** — Collections created
2. 🔄 **Create Appwrite Teams** — One per client
3. 🚀 **Build Next.js Dashboard** — Using the schema
4. 🤖 **Connect WhatsApp Webhook** — Start receiving messages
5. 🧠 **Integrate OpenAI** — AI chatbot training
6. 📊 **Build API Routes** — Campaign sending, webhooks

---

## Troubleshooting

### Error: "401 Unauthorized"
- Your API key is wrong or expired
- Generate a new one: https://cloud.appwrite.io/console/project-[ID]/settings/api-keys

### Error: "404 Not Found - Project"
- Your PROJECT_ID doesn't exist
- Check your Appwrite console for the correct ID

### Error: "409 Conflict - Collection already exists"
- The collection was already created
- Script will skip it and continue
- No need to delete and recreate

### Script hangs or times out
- Check your internet connection
- Appwrite cloud might be temporarily unavailable
- Try again in a few moments

---

## Security Notes

🔒 **IMPORTANT:**

- Never commit `.env.local` to git — add it to `.gitignore`
- Never share your `APPWRITE_API_KEY` publicly
- Use server-side only for sensitive operations
- All token storage in Appwrite is encrypted
- Always use HTTPS in production

---

## File Structure After Setup

```
project-root/
├── appwrite-setup.js          ← Main setup script
├── package.json               ← Dependencies
├── .env.local                 ← Your secret keys (add to .gitignore)
├── README.md                  ← This file
└── app/                       ← Your Next.js app (coming next)
    ├── (platform)/
    │   ├── layout.tsx
    │   ├── login/page.tsx
    │   └── dashboard/...
    └── api/
        ├── whatsapp/webhook/route.ts
        └── ...
```

---

## Need Help?

- **Appwrite Docs:** https://appwrite.io/docs
- **WhatsApp Cloud API:** https://developers.facebook.com/docs/whatsapp/cloud-api
- **OpenAI Docs:** https://platform.openai.com/docs
- **Google My Business API:** https://developers.google.com/my-business

