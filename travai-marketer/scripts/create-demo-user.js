/**
 * Create a demo user in Appwrite for testing the platform.
 *
 * Usage:
 *   node scripts/create-demo-user.js
 *
 * Reads APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY from .env.local.
 */

const { Client, Users, ID } = require('node-appwrite');
const fs = require('fs');
const path = require('path');

// Load .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env.local not found at', envPath);
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const DEMO_EMAIL = 'demo@travai.com';
const DEMO_PASSWORD = 'demo123456';
const DEMO_NAME = 'Demo User';

async function main() {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!endpoint || !projectId || !apiKey) {
    console.error('❌ Missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY in .env.local');
    process.exit(1);
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const users = new Users(client);

  console.log(`Creating demo user: ${DEMO_EMAIL}`);

  try {
    const user = await users.create(
      ID.unique(),
      DEMO_EMAIL,
      undefined, // phone
      DEMO_PASSWORD,
      DEMO_NAME
    );
    console.log('✅ Demo user created successfully!');
    console.log('   ID:    ', user.$id);
    console.log('   Email: ', user.email);
    console.log('   Name:  ', user.name);
    console.log('');
    console.log('🔑 Login at /login with:');
    console.log('   Email:    demo@travai.com');
    console.log('   Password: demo123456');
  } catch (err) {
    if (err.code === 409 || err.type === 'user_already_exists') {
      console.log('ℹ️  User already exists. Resetting password...');
      // Find the user and update password
      const list = await users.list([`equal("email", "${DEMO_EMAIL}")`]);
      if (list.users && list.users.length > 0) {
        const userId = list.users[0].$id;
        await users.updatePassword(userId, DEMO_PASSWORD);
        console.log('✅ Password reset for existing demo user.');
        console.log('');
        console.log('🔑 Login at /login with:');
        console.log('   Email:    demo@travai.com');
        console.log('   Password: demo123456');
      } else {
        console.log('⚠️  Could not locate existing user to reset password.');
      }
    } else {
      console.error('❌ Error:', err.message || err);
      process.exit(1);
    }
  }
}

main();
