#!/usr/bin/env node

/**
 * List all Appwrite Projects
 * 
 * Helps find the correct project ID
 */

require('dotenv').config({ path: '.env.local' });

const sdk = require('node-appwrite');

async function listProjects() {
  console.log('\n🔍 Listing Appwrite Projects...\n');

  const endpoint = process.env.APPWRITE_ENDPOINT;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!endpoint || !apiKey) {
    console.error('❌ Missing APPWRITE_ENDPOINT or APPWRITE_API_KEY in .env.local\n');
    process.exit(1);
  }

  try {
    const client = new sdk.Client()
      .setEndpoint(endpoint)
      .setKey(apiKey);

    const projects = new sdk.Projects(client);

    console.log('📡 Fetching all projects...\n');
    const response = await projects.list();
    
    if (response.projects.length === 0) {
      console.log('No projects found. Create one at: https://cloud.appwrite.io/console\n');
      return;
    }

    console.log(`Found ${response.projects.length} project(s):\n`);
    response.projects.forEach(project => {
      console.log(`📌 ${project.name}`);
      console.log(`   ID: ${project.$id}`);
      console.log(`   Region: ${project.region}`);
      console.log('');
    });

    console.log('💡 Copy the correct Project ID and update APPWRITE_PROJECT_ID in .env.local\n');

  } catch (error) {
    console.error('❌ Error:\n');
    console.error('Message:', error.message);
    
    if (error.code === 401 || error.code === 403) {
      console.error('\n🔴 Your API key does not have permission to list projects');
      console.error('   Make sure you\'re using a project API key (not a personal key)');
      console.error('   Generate one at: https://cloud.appwrite.io/console/project-[ID]/settings/api-keys');
    }
    
    console.log('');
    process.exit(1);
  }
}

listProjects();
