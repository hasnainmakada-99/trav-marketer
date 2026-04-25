/**
 * TravAI Marketer — Appwrite Database Setup Script
 * 
 * This script initializes the complete database schema for the multi-tenant
 * AI Marketing platform. Run this once to create all collections, attributes,
 * indexes, and permissions.
 * 
 * Usage: node appwrite-setup.js
 */

const sdk = require('node-appwrite');

// Configuration
const APPWRITE_ENDPOINT = 'https://cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID;
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = 'travai'; // Use this ID or create a new one

const client = new sdk.Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const databases = new sdk.Databases(client);

// ============================================================================
// COLLECTION DEFINITIONS
// ============================================================================

const collections = {
  // 1. BUSINESS CONFIGS — Per-client configuration (WhatsApp, Google, AI training)
  business_configs: {
    id: 'business_configs',
    name: 'Business Configs',
    attributes: [
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
        encrypted: false,
      },
      {
        key: 'businessName',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'businessDescription',
        type: 'string',
        required: false,
        array: false,
        size: 1024,
      },
      {
        key: 'whatsappToken',
        type: 'string',
        required: true,
        array: false,
        size: 512,
        encrypted: true, // Sensitive data
      },
      {
        key: 'whatsappPhoneNumberId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'whatsappVerifyToken',
        type: 'string',
        required: true,
        array: false,
        size: 256,
        encrypted: true,
      },
      {
        key: 'openaiSystemPrompt',
        type: 'string',
        required: false,
        array: false,
        size: 2048, // Large text for business-specific AI training
      },
      {
        key: 'googleAccessToken',
        type: 'string',
        required: false,
        array: false,
        size: 512,
        encrypted: true,
      },
      {
        key: 'googleRefreshToken',
        type: 'string',
        required: false,
        array: false,
        size: 512,
        encrypted: true,
      },
      {
        key: 'googleLocationId',
        type: 'string',
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
      {
        key: 'updatedAt',
        type: 'datetime',
        required: true,
      },
    ],
    indexes: [
      { key: 'teamId', type: 'key', attributes: ['teamId'] },
    ],
  },

  // 2. CUSTOMERS — All customer records with contact info and tags
  customers: {
    id: 'customers',
    name: 'Customers',
    attributes: [
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'phone',
        type: 'string',
        required: true,
        array: false,
        size: 20,
      },
      {
        key: 'name',
        type: 'string',
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'email',
        type: 'email',
        required: false,
        array: false,
      },
      {
        key: 'source',
        type: 'string', // whatsapp / missed_call / walk_in / campaign
        required: true,
        array: false,
        size: 50,
      },
      {
        key: 'tags',
        type: 'string',
        required: false,
        array: true,
        size: 100,
      },
      {
        key: 'totalSpent',
        type: 'integer',
        required: false,
        array: false,
        default: 0,
      },
      {
        key: 'lastPurchaseDate',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'notes',
        type: 'string',
        required: false,
        array: false,
        size: 1024,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
      {
        key: 'updatedAt',
        type: 'datetime',
        required: true,
      },
    ],
    indexes: [
      { key: 'teamId_phone', type: 'key', attributes: ['teamId', 'phone'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 3. CONVERSATIONS — Chat history (WhatsApp messages)
  conversations: {
    id: 'conversations',
    name: 'Conversations',
    attributes: [
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'customerId',
        type: 'string', // References customers.$id
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'phone',
        type: 'string', // Denormalized for quick queries
        required: true,
        array: false,
        size: 20,
      },
      {
        key: 'role',
        type: 'string', // "user" or "assistant"
        required: true,
        array: false,
        size: 50,
      },
      {
        key: 'message',
        type: 'string',
        required: true,
        array: false,
        size: 2048,
      },
      {
        key: 'messageType',
        type: 'string', // "text" / "image" / "document" / "template"
        required: false,
        array: false,
        size: 50,
      },
      {
        key: 'sentBy',
        type: 'string', // "ai" / "customer" / "staff"
        required: true,
        array: false,
        size: 50,
      },
      {
        key: 'metaMessageId',
        type: 'string', // ID from Meta API (for delivery tracking)
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'deliveryStatus',
        type: 'string', // "sent" / "delivered" / "read" / "failed"
        required: false,
        array: false,
        size: 50,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
    ],
    indexes: [
      { key: 'teamId_phone', type: 'key', attributes: ['teamId', 'phone'] },
      { key: 'teamId_customerId', type: 'key', attributes: ['teamId', 'customerId'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 4. LEADS — Sales pipeline (new / contacted / qualified / converted / lost)
  leads: {
    id: 'leads',
    name: 'Leads',
    attributes: [
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'phone',
        type: 'string',
        required: true,
        array: false,
        size: 20,
      },
      {
        key: 'name',
        type: 'string',
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'email',
        type: 'email',
        required: false,
        array: false,
      },
      {
        key: 'source',
        type: 'string', // whatsapp / missed_call / walk_in / campaign
        required: true,
        array: false,
        size: 50,
      },
      {
        key: 'status',
        type: 'string', // new / contacted / qualified / converted / lost
        required: true,
        array: false,
        size: 50,
        default: 'new',
      },
      {
        key: 'assignedTo',
        type: 'string', // Appwrite user ID
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'value',
        type: 'integer', // Estimated deal value in rupees
        required: false,
        array: false,
        default: 0,
      },
      {
        key: 'notes',
        type: 'string',
        required: false,
        array: false,
        size: 2048,
      },
      {
        key: 'lastContactedAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
      {
        key: 'updatedAt',
        type: 'datetime',
        required: true,
      },
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
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'title',
        type: 'string', // Internal name
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'type',
        type: 'string', // repeat_purchase / upsell / review_request / reminder / payment
        required: true,
        array: false,
        size: 50,
      },
      {
        key: 'templateName',
        type: 'string', // Meta-approved WhatsApp template name
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'message',
        type: 'string', // GPT-generated message text
        required: true,
        array: false,
        size: 2048,
      },
      {
        key: 'segment',
        type: 'string', // all / last_purchase_30d / specific_tag / specific_status
        required: true,
        array: false,
        size: 100,
      },
      {
        key: 'segmentValue',
        type: 'string', // Tag name or status value (if segment is specific_tag/specific_status)
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'status',
        type: 'string', // draft / scheduled / sent / failed
        required: true,
        array: false,
        size: 50,
        default: 'draft',
      },
      {
        key: 'scheduledAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'sentAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'totalSent',
        type: 'integer',
        required: false,
        array: false,
        default: 0,
      },
      {
        key: 'totalDelivered',
        type: 'integer',
        required: false,
        array: false,
        default: 0,
      },
      {
        key: 'totalRead',
        type: 'integer',
        required: false,
        array: false,
        default: 0,
      },
      {
        key: 'totalReplied',
        type: 'integer',
        required: false,
        array: false,
        default: 0,
      },
      {
        key: 'createdBy',
        type: 'string', // Appwrite user ID
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
      {
        key: 'updatedAt',
        type: 'datetime',
        required: true,
      },
    ],
    indexes: [
      { key: 'teamId_status', type: 'key', attributes: ['teamId', 'status'] },
      { key: 'teamId_scheduledAt', type: 'key', attributes: ['teamId', 'scheduledAt'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 6. CAMPAIGN LOGS — Individual campaign delivery tracking
  campaign_logs: {
    id: 'campaign_logs',
    name: 'Campaign Logs',
    attributes: [
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'campaignId',
        type: 'string', // References campaigns.$id
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'phone',
        type: 'string',
        required: true,
        array: false,
        size: 20,
      },
      {
        key: 'customerId',
        type: 'string', // References customers.$id
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'status',
        type: 'string', // sent / delivered / read / failed
        required: true,
        array: false,
        size: 50,
      },
      {
        key: 'metaMessageId',
        type: 'string', // ID from Meta API
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'sentAt',
        type: 'datetime',
        required: true,
      },
      {
        key: 'deliveredAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'readAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'error',
        type: 'string', // Error message if failed
        required: false,
        array: false,
        size: 512,
      },
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
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'title',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'content',
        type: 'string', // GPT-generated post content
        required: true,
        array: false,
        size: 2048,
      },
      {
        key: 'googlePostId',
        type: 'string', // ID returned by GBP API after posting
        required: false,
        array: false,
        size: 256,
      },
      {
        key: 'status',
        type: 'string', // draft / posted / failed
        required: true,
        array: false,
        size: 50,
        default: 'draft',
      },
      {
        key: 'postedAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'type',
        type: 'string', // auto_generated / manual
        required: true,
        array: false,
        size: 50,
        default: 'auto_generated',
      },
      {
        key: 'createdBy',
        type: 'string', // Appwrite user ID
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
      {
        key: 'updatedAt',
        type: 'datetime',
        required: true,
      },
    ],
    indexes: [
      { key: 'teamId_status', type: 'key', attributes: ['teamId', 'status'] },
      { key: 'teamId_createdAt', type: 'key', attributes: ['teamId', 'createdAt'] },
    ],
  },

  // 8. GBP REVIEWS — Google Business Profile reviews (for tracking)
  gbp_reviews: {
    id: 'gbp_reviews',
    name: 'GBP Reviews',
    attributes: [
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'googleReviewId',
        type: 'string', // ID from Google API
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'reviewer',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'rating',
        type: 'integer',
        required: true,
        array: false,
      },
      {
        key: 'reviewText',
        type: 'string',
        required: true,
        array: false,
        size: 2048,
      },
      {
        key: 'reply',
        type: 'string', // AI-generated reply
        required: false,
        array: false,
        size: 2048,
      },
      {
        key: 'replyStatus',
        type: 'string', // pending / replied
        required: true,
        array: false,
        size: 50,
        default: 'pending',
      },
      {
        key: 'repliedAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
    ],
    indexes: [
      { key: 'teamId_replyStatus', type: 'key', attributes: ['teamId', 'replyStatus'] },
      { key: 'googleReviewId', type: 'key', attributes: ['googleReviewId'] },
    ],
  },

  // 9. STAFF ROLES — Staff members and their roles/permissions
  staff: {
    id: 'staff',
    name: 'Staff',
    attributes: [
      {
        key: 'teamId',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'userId',
        type: 'string', // Appwrite user ID
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'name',
        type: 'string',
        required: true,
        array: false,
        size: 256,
      },
      {
        key: 'email',
        type: 'email',
        required: true,
        array: false,
      },
      {
        key: 'role',
        type: 'string', // owner / admin / manager / staff
        required: true,
        array: false,
        size: 50,
      },
      {
        key: 'permissions',
        type: 'string', // JSON: can_view_all_leads, can_create_campaigns, etc.
        required: false,
        array: false,
        size: 1024,
      },
      {
        key: 'status',
        type: 'string', // active / inactive / suspended
        required: true,
        array: false,
        size: 50,
        default: 'active',
      },
      {
        key: 'lastLoginAt',
        type: 'datetime',
        required: false,
        array: false,
      },
      {
        key: 'createdAt',
        type: 'datetime',
        required: true,
      },
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
    console.log('🚀 Starting Appwrite Database Setup...\n');
    console.log(`Endpoint: ${APPWRITE_ENDPOINT}`);
    console.log(`Project ID: ${APPWRITE_PROJECT_ID}`);
    console.log(`Database ID: ${DATABASE_ID}\n`);

    // Step 1: Create or get database
    let database;
    try {
      database = await databases.get(DATABASE_ID);
      console.log(`✅ Database "${DATABASE_ID}" already exists`);
    } catch (error) {
      if (error.code === 404) {
        console.log(`📝 Creating database "${DATABASE_ID}"...`);
        database = await databases.create(DATABASE_ID, DATABASE_ID);
        console.log(`✅ Database created successfully`);
      } else {
        throw error;
      }
    }

    // Step 2: Create all collections
    for (const [collectionKey, collectionDef] of Object.entries(collections)) {
      try {
        // Try to get existing collection
        const existing = await databases.getCollection(DATABASE_ID, collectionDef.id);
        console.log(`\n⏭️  Collection "${collectionDef.name}" already exists, skipping...`);
        continue;
      } catch (error) {
        if (error.code !== 404) {
          throw error;
        }
      }

      // Create collection
      console.log(`\n📝 Creating collection "${collectionDef.name}"...`);
      const collection = await databases.createCollection(
        DATABASE_ID,
        collectionDef.id,
        collectionDef.name
      );
      console.log(`  ✅ Collection created`);

      // Add attributes
      console.log(`  📝 Adding ${collectionDef.attributes.length} attributes...`);
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
          console.log(`    ✓ ${attr.key} (${attr.type})`);
        } catch (error) {
          if (error.code === 409) {
            // Attribute already exists
            console.log(`    ⏭️  ${attr.key} already exists`);
          } else {
            throw error;
          }
        }
      }

      // Add indexes
      if (collectionDef.indexes && collectionDef.indexes.length > 0) {
        console.log(`  📝 Adding ${collectionDef.indexes.length} indexes...`);
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
            console.log(`    ✓ ${index.key}`);
          } catch (error) {
            if (error.code === 409) {
              console.log(`    ⏭️  ${index.key} already exists`);
            } else {
              throw error;
            }
          }
        }
      }
    }

    console.log('\n\n✅ Database setup completed successfully!\n');
    console.log('📋 Summary:');
    console.log(`  - Collections created: ${Object.keys(collections).length}`);
    console.log('  - Collections:');
    Object.values(collections).forEach(col => {
      console.log(`    • ${col.name} (${col.attributes.length} attributes)`);
    });

    console.log('\n💡 Next Steps:');
    console.log('  1. Configure environment variables:');
    console.log('     - APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1');
    console.log(`     - APPWRITE_PROJECT_ID=${APPWRITE_PROJECT_ID}`);
    console.log(`     - APPWRITE_API_KEY=${APPWRITE_API_KEY}`);
    console.log('\n  2. Create Appwrite Teams for each client');
    console.log('  3. Start building API routes and dashboard');

  } catch (error) {
    console.error('\n❌ Error during setup:', error.message);
    console.error('Details:', error);
    process.exit(1);
  }
}

// Run setup
setupDatabase();
