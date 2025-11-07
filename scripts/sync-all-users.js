#!/usr/bin/env node

/**
 * 🔄 Manual Sync Enabled Users Script
 * Usage: node sync-all-users.js <TOKEN> [TICKET_SERVICE_URL]
 *
 * This script syncs only ENABLED users from Frappe for better performance.
 *
 * Example:
 *   node sync-all-users.js eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 */

const axios = require('axios');

const args = process.argv.slice(2);
const token = args[0];
const baseURL = args[1] || 'https://admin.sis.wellspring.edu.vn';

if (!token) {
  console.error('❌ Error: Token required');
  console.error('Usage: node sync-all-users.js <TOKEN> [TICKET_SERVICE_URL]');
  console.error('');
  console.error('Example:');
  console.error('  node sync-all-users.js eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
  console.error('  node sync-all-users.js <TOKEN> https://localhost:5004');
  process.exit(1);
}

const syncAllUsers = async () => {
  try {
    const url = `${baseURL}/api/ticket/user/sync/manual`;
    
    console.log('🔄 Starting Enabled User Sync...');
    console.log(`URL: ${url} (enabled users only)`);
    console.log('');
    
    const response = await axios.post(url, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = response.data;
    
    console.log('Response:');
    console.log(JSON.stringify(data, null, 2));
    console.log('');
    
    if (data.success) {
      console.log('✅ Sync completed successfully!');
      
      if (data.stats) {
        const { synced, failed, total } = data.stats;
        console.log(`📊 Stats:`);
        console.log(`   ✅ Synced: ${synced}`);
        console.log(`   ❌ Failed: ${failed}`);
        console.log(`   📋 Total:  ${total}`);
      }
      
      if (data.synced_users && data.synced_users.length > 0) {
        console.log('');
        console.log('📝 Synced Users:');
        data.synced_users.forEach((user, idx) => {
          console.log(`   ${idx + 1}. ${user.fullname} (${user.email})`);
          if (user.roles && user.roles.length > 0) {
            console.log(`      Roles: ${user.roles.join(', ')}`);
          }
        });
      }
    } else {
      console.log(`❌ Sync failed: ${data.message}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
};

syncAllUsers();
