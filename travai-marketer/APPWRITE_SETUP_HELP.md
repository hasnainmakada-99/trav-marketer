# ⚠️ IMPORTANT: Fix Your Appwrite Configuration

Your current Appwrite credentials are not working. Follow these steps to fix it:

## Step 1: Get Your Correct Project ID

1. Open https://cloud.appwrite.io/console in your browser
2. You should see your projects listed
3. Click on your project to open it
4. Look at the URL bar — it shows something like: `https://cloud.appwrite.io/console/project/[PROJECT_ID]/overview`
5. Copy the `[PROJECT_ID]` part (it's a long string of characters)

## Step 2: Generate or Verify Your API Key

1. In the Appwrite console, go to **Settings** (bottom left)
2. Click on **API Keys** tab
3. Create a new API key (or use an existing one) with these scopes:
   - `databases.read`
   - `databases.write`
   - `collections.read`
   - `collections.write`
   - `attributes.read`
   - `attributes.write`
   - `indexes.read`
   - `indexes.write`
   - `documents.read`
   - `documents.write`

4. Copy the full API key (starts with `standard_`)

## Step 3: Update Your .env.local

Open `.env.local` and update these lines:

```env
# Replace these with your actual values
APPWRITE_PROJECT_ID=YOUR_PROJECT_ID_HERE
APPWRITE_API_KEY=YOUR_API_KEY_HERE
```

Example (with fake data):
```env
APPWRITE_PROJECT_ID=670a1b2c3d4e5f6g7h8i9j0k
APPWRITE_API_KEY=standard_abcdef123456789abcdef123456789abcdef123456789abcdef123456
```

## Step 4: Verify Your Configuration

Run this command to test your credentials:

```bash
npm run verify-config
```

You should see:
```
✅ Connection successful!

   Found X database(s):
   • travai-marketing
   • ...

✅ Appwrite configuration is correct!
```

## Step 5: Initialize the Database

Once verification passes, run:

```bash
npm run setup-db
```

This will create all collections and indexes.

---

## Troubleshooting

### "Project ID not found"
- Your PROJECT_ID is incorrect
- Go to https://cloud.appwrite.io/console
- Check the URL to get the correct ID

### "API Key invalid or unauthorized"
- Your API key is incorrect or expired
- Generate a new one from Settings > API Keys
- Make sure it has the required scopes (see Step 2)

### "Collections already exist"
- Database was already initialized
- You can safely run `npm run setup-db` again — it will skip existing collections

### Still not working?
- Delete the current database from Appwrite console
- Run `npm run setup-db` again to create a fresh one

---

## Minimum Appwrite Scopes Required

Your API key needs at least these scopes to create collections:

```
✓ databases.read
✓ databases.write
✓ collections.read
✓ collections.write
✓ attributes.read
✓ attributes.write
✓ indexes.read
✓ indexes.write
✓ documents.read
✓ documents.write
```

**Pro tip:** Select **All** to make it simpler, or paste this into the scopes field:
```
databases.read databases.write collections.read collections.write attributes.read attributes.write indexes.read indexes.write documents.read documents.write
```

---

## What to do next:

1. ✅ Get correct Project ID
2. ✅ Generate new API key
3. ✅ Update .env.local
4. ✅ Run `npm run verify-config`
5. ✅ Run `npm run setup-db`
6. ✅ Start with `npm run dev`

---

Need more help? Check the official docs:
- https://appwrite.io/docs/getting-started
- https://appwrite.io/docs/authentication
