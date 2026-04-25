#!/usr/bin/env node

/**
 * Appwrite Configuration Verification
 * 
 * Verifies that your Appwrite credentials are correct
 */

require('dotenv').config({ path: '.env.local' });

const sdk = require('node-appwrite');

async function verify() {
  console.log('\n🔍 Verifying Appwrite Configuration...\n');

  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  console.log('Configuration loaded from .env.local:');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Project ID: ${projectId}`);
  console.log(`  API Key: ${apiKey ? '✓ Set (hidden)' : '✗ Missing'}\n`);

  if (!endpoint || !projectId || !apiKey) {
    console.error('❌ Missing configuration. Please set all variables in .env.local\n');
    process.exit(1);
  }

  try {
    const client = new sdk.Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(apiKey);

    const databases = new sdk.Databases(client);

    console.log('📡 Testing connection...');
    
    // Try to list all databases to verify credentials
    const response = await databases.list();
    
    console.log('✅ Connection successful!\n');
    console.log(`   Found ${response.databases.length} database(s):`);
    response.databases.forEach(db => {
      console.log(`   • ${db.name} (ID: ${db.$id})`);
    });

    console.log('\n✅ Appwrite configuration is correct!\n');
    console.log('💡 Next: Run npm run setup-db to initialize the database schema\n');

  } catch (error) {
    console.error('❌ Connection failed!\n');
    console.error('Error:', error.message);
    
    if (error.code === 404) {
      console.error('\n🔴 Issue: Project ID not found');
      console.error('   Solution: Check your APPWRITE_PROJECT_ID in .env.local');
      console.error('   Get the correct ID from: https://cloud.appwrite.io/console');
    } else if (error.code === 401) {
      console.error('\n🔴 Issue: API Key invalid or unauthorized');
      console.error('   Solution: Generate a new API key from:');
      console.error('   https://cloud.appwrite.io/console/project-[ID]/settings/api-keys');
    }
    
    console.log('\n');
    process.exit(1);
  }
}

verify();
