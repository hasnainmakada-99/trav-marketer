#!/usr/bin/env node

/**
 * TravAI Marketer — Appwrite Database Setup Script
 * 
 * This script initializes the complete database schema for the multi-tenant
 * AI Marketing platform. Run this once to create all collections, attributes,
 * indexes, and permissions.
 * 
 * Usage: node scripts/setup-database.js
 */

require('dotenv').config({ path: '.env.local' });

const sdk = require('node-appwrite');

// Configuration from environment
const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID;
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'travai';

if (!APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
  console.error('❌ Error: Missing APPWRITE_PROJECT_ID or APPWRITE_API_KEY in .env.local');
  process.exit(1);
}

const client = new sdk.Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const databases = new sdk.Databases(client);

// ============================================================================
// COLLECTION DEFINITIONS
// ============================================================================

const collections = {
  // 1. BUSINESS CONFIGS — Per-client configuration
  business_configs: {
    id: 'business_configs',
    name: 'Business Configs',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'businessName', type: 'string', required: true, size: 256 },
      { key: 'businessDescription', type: 'string', required: false, size: 1024 },
      { key: 'whatsappToken', type: 'string', required: true, size: 512, encrypted: true },
      { key: 'whatsappPhoneNumberId', type: 'string', required: true, size: 256 },
      { key: 'whatsappVerifyToken', type: 'string', required: true, size: 256, encrypted: true },
      { key: 'openaiSystemPrompt', type: 'string', required: false, size: 2048 },
      { key: 'googleAccessToken', type: 'string', required: false, size: 512, encrypted: true },
      { key: 'googleRefreshToken', type: 'string', required: false, size: 512, encrypted: true },
      { key: 'googleLocationId', type: 'string', required: false, size: 256 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [{ key: 'teamId', type: 'key', attributes: ['teamId'] }],
  },

  // 2. CUSTOMERS — All customer records
  customers: {
    id: 'customers',
    name: 'Customers',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'phone', type: 'string', required: true, size: 20 },
      { key: 'name', type: 'string', required: false, size: 256 },
      { key: 'email', type: 'email', required: false },
      { key: 'source', type: 'string', required: true, size: 50 },
      { key: 'tags', type: 'string', required: false, array: true, size: 100 },
      { key: 'totalSpent', type: 'integer', required: false },
      { key: 'lastPurchaseDate', type: 'datetime', required: false },
      { key: 'notes', type: 'string', required: false, size: 1024 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'teamId_phone', type: 'key', attributes: ['teamId', 'phone'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 3. CONVERSATIONS — Chat history
  conversations: {
    id: 'conversations',
    name: 'Conversations',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'customerId', type: 'string', required: true, size: 256 },
      { key: 'phone', type: 'string', required: true, size: 20 },
      { key: 'role', type: 'string', required: true, size: 50 },
      { key: 'message', type: 'string', required: true, size: 2048 },
      { key: 'messageType', type: 'string', required: false, size: 50 },
      { key: 'sentBy', type: 'string', required: true, size: 50 },
      { key: 'metaMessageId', type: 'string', required: false, size: 256 },
      { key: 'deliveryStatus', type: 'string', required: false, size: 50 },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'teamId_phone', type: 'key', attributes: ['teamId', 'phone'] },
      { key: 'teamId_customerId', type: 'key', attributes: ['teamId', 'customerId'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 4. LEADS — Sales pipeline
  leads: {
    id: 'leads',
    name: 'Leads',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'phone', type: 'string', required: true, size: 20 },
      { key: 'name', type: 'string', required: false, size: 256 },
      { key: 'email', type: 'email', required: false },
      { key: 'source', type: 'string', required: true, size: 50 },
      { key: 'status', type: 'string', required: false, size: 50 },
      { key: 'assignedTo', type: 'string', required: false, size: 256 },
      { key: 'value', type: 'integer', required: false },
      { key: 'notes', type: 'string', required: false, size: 2048 },
      { key: 'lastContactedAt', type: 'datetime', required: false },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'teamId_status', type: 'key', attributes: ['teamId', 'status'] },
      { key: 'teamId_phone', type: 'key', attributes: ['teamId', 'phone'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
      { key: 'assignedTo', type: 'key', attributes: ['assignedTo'] },
    ],
  },

  // 5. CAMPAIGNS — Marketing campaigns
  campaigns: {
    id: 'campaigns',
    name: 'Campaigns',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'title', type: 'string', required: true, size: 256 },
      { key: 'type', type: 'string', required: true, size: 50 },
      { key: 'templateName', type: 'string', required: true, size: 256 },
      { key: 'message', type: 'string', required: true, size: 2048 },
      { key: 'segment', type: 'string', required: true, size: 100 },
      { key: 'segmentValue', type: 'string', required: false, size: 256 },
      { key: 'status', type: 'string', required: false, size: 50 },
      { key: 'scheduledAt', type: 'datetime', required: false },
      { key: 'sentAt', type: 'datetime', required: false },
      { key: 'totalSent', type: 'integer', required: false },
      { key: 'totalDelivered', type: 'integer', required: false },
      { key: 'totalRead', type: 'integer', required: false },
      { key: 'totalReplied', type: 'integer', required: false },
      { key: 'createdBy', type: 'string', required: true, size: 256 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'teamId_status', type: 'key', attributes: ['teamId', 'status'] },
      { key: 'teamId_scheduledAt', type: 'key', attributes: ['teamId', 'scheduledAt'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 6. CAMPAIGN LOGS — Delivery tracking
  campaign_logs: {
    id: 'campaign_logs',
    name: 'Campaign Logs',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'campaignId', type: 'string', required: true, size: 256 },
      { key: 'phone', type: 'string', required: true, size: 20 },
      { key: 'customerId', type: 'string', required: true, size: 256 },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'metaMessageId', type: 'string', required: false, size: 256 },
      { key: 'sentAt', type: 'datetime', required: true },
      { key: 'deliveredAt', type: 'datetime', required: false },
      { key: 'readAt', type: 'datetime', required: false },
      { key: 'error', type: 'string', required: false, size: 512 },
    ],
    indexes: [
      { key: 'teamId_campaignId', type: 'key', attributes: ['teamId', 'campaignId'] },
      { key: 'teamId_phone', type: 'key', attributes: ['teamId', 'phone'] },
      { key: 'status', type: 'key', attributes: ['status'] },
    ],
  },

  // 7. GBP POSTS — Google Business Profile posts
  gbp_posts: {
    id: 'gbp_posts',
    name: 'GBP Posts',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'title', type: 'string', required: true, size: 256 },
      { key: 'content', type: 'string', required: true, size: 2048 },
      { key: 'googlePostId', type: 'string', required: false, size: 256 },
      { key: 'status', type: 'string', required: false, size: 50 },
      { key: 'postedAt', type: 'datetime', required: false },
      { key: 'type', type: 'string', required: false, size: 50 },
      { key: 'createdBy', type: 'string', required: true, size: 256 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'teamId_status', type: 'key', attributes: ['teamId', 'status'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 8. GBP REVIEWS — Review tracking
  gbp_reviews: {
    id: 'gbp_reviews',
    name: 'GBP Reviews',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'googleReviewId', type: 'string', required: true, size: 256 },
      { key: 'reviewer', type: 'string', required: true, size: 256 },
      { key: 'rating', type: 'integer', required: true },
      { key: 'reviewText', type: 'string', required: true, size: 2048 },
      { key: 'reply', type: 'string', required: false, size: 2048 },
      { key: 'replyStatus', type: 'string', required: false, size: 50 },
      { key: 'repliedAt', type: 'datetime', required: false },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'teamId_replyStatus', type: 'key', attributes: ['teamId', 'replyStatus'] },
      { key: 'googleReviewId', type: 'key', attributes: ['googleReviewId'] },
    ],
  },

  // 9. STAFF — Team members
  staff: {
    id: 'staff',
    name: 'Staff',
    attributes: [
      { key: 'teamId', type: 'string', required: true, size: 256 },
      { key: 'userId', type: 'string', required: true, size: 256 },
      { key: 'name', type: 'string', required: true, size: 256 },
      { key: 'email', type: 'email', required: true },
      { key: 'role', type: 'string', required: true, size: 50 },
      { key: 'permissions', type: 'string', required: false, size: 1024 },
      { key: 'status', type: 'string', required: false, size: 50 },
      { key: 'lastLoginAt', type: 'datetime', required: false },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'teamId_role', type: 'key', attributes: ['teamId', 'role'] },
      { key: 'userId', type: 'key', attributes: ['userId'] },
    ],
  },
};

// ============================================================================
// SETUP FUNCTION
// ============================================================================

async function setupDatabase() {
  try {
    console.log('\n🚀 TravAI Marketer — Appwrite Database Setup\n');
    console.log('═'.repeat(60));
    console.log(`📍 Endpoint: ${APPWRITE_ENDPOINT}`);
    console.log(`📍 Project ID: ${APPWRITE_PROJECT_ID}`);
    console.log(`📍 Database ID: ${DATABASE_ID}`);
    console.log('═'.repeat(60) + '\n');

    // Step 1: Create or get database
    let database;
    try {
      database = await databases.get(DATABASE_ID);
      console.log(`✅ Database "${DATABASE_ID}" already exists\n`);
    } catch (error) {
      if (error.code === 404) {
        console.log(`📝 Creating database "${DATABASE_ID}"...`);
        database = await databases.create(DATABASE_ID, DATABASE_ID);
        console.log(`✅ Database created successfully\n`);
      } else {
        throw error;
      }
    }

    // Step 2: Create all collections
    for (const [collectionKey, collectionDef] of Object.entries(collections)) {
      try {
        const existing = await databases.getCollection(DATABASE_ID, collectionDef.id);
        console.log(`⏭️  Collection "${collectionDef.name}" already exists`);
        continue;
      } catch (error) {
        if (error.code !== 404) {
          throw error;
        }
      }

      console.log(`\n📝 Creating collection "${collectionDef.name}"...`);
      const collection = await databases.createCollection(
        DATABASE_ID,
        collectionDef.id,
        collectionDef.name
      );
      console.log(`   ✅ Collection created`);

      // Add attributes
      console.log(`   📝 Adding ${collectionDef.attributes.length} attributes...`);
      for (const attr of collectionDef.attributes) {
        try {
          if (attr.type === 'string') {
            await databases.createStringAttribute(
              DATABASE_ID,
              collectionDef.id,
              attr.key,
              attr.size,
              attr.required,
              attr.default || undefined,
              attr.encrypted || false
            );
          } else if (attr.type === 'integer') {
            await databases.createIntegerAttribute(
              DATABASE_ID,
              collectionDef.id,
              attr.key,
              attr.required,
              attr.default || undefined
            );
          } else if (attr.type === 'email') {
            await databases.createEmailAttribute(
              DATABASE_ID,
              collectionDef.id,
              attr.key,
              attr.required,
              attr.default || undefined
            );
          } else if (attr.type === 'datetime') {
            await databases.createDatetimeAttribute(
              DATABASE_ID,
              collectionDef.id,
              attr.key,
              attr.required,
              attr.default || undefined
            );
          }
        } catch (error) {
          if (error.code === 409) {
            // Attribute already exists
          } else {
            throw error;
          }
        }
      }
      console.log(`      ✓ All attributes added`);

      // Add indexes
      if (collectionDef.indexes && collectionDef.indexes.length > 0) {
        console.log(`   📝 Adding ${collectionDef.indexes.length} indexes...`);
        for (const index of collectionDef.indexes) {
          try {
            await databases.createIndex(
              DATABASE_ID,
              collectionDef.id,
              index.key,
              index.type,
              index.attributes,
              index.orders || []
            );
          } catch (error) {
            if (error.code !== 409) {
              throw error;
            }
          }
        }
        console.log(`      ✓ All indexes added`);
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('\n✅ Database setup completed successfully!\n');
    console.log('📋 Summary:');
    console.log(`   ✓ Collections: ${Object.keys(collections).length}`);
    console.log('   ✓ Collections created:');
    Object.values(collections).forEach(col => {
      console.log(`      • ${col.name}`);
    });

    console.log('\n💡 Next Steps:');
    console.log('   1. npm run setup-functions (deploy scheduled functions)');
    console.log('   2. npm run dev (start development server)');
    console.log('   3. Create Appwrite Teams for each client');
    console.log('   4. Build dashboard pages and API routes\n');

  } catch (error) {
    console.error('\n❌ Error during setup:', error.message);
    if (error.response) {
      console.error('Response:', error.response);
    }
    process.exit(1);
  }
}

// Run setup
setupDatabase();
