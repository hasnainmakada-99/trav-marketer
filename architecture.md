                    ┌─────────────────────────────────┐
                    │   Vercel (Next.js App Router)   │
                    │   trav-marketer.vercel.app       │
                    └──────────┬──────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
  YCloud API             OpenAI GPT-4o         Google Business
  (WhatsApp)            (AI responses)          Profile APIs
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Appwrite Cloud    │ ← Database + Auth
                    │   (travai DB)       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Oracle Cloud VM    │ ← WhatsApp Bridge
                    │  (Baileys/WA Web)   │   (always-on process)
                    └─────────────────────┘
