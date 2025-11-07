#!/usr/bin/env node

/**
 * 🔄 Manual Sync Enabled Users Script
 * Usage: node sync-all-users.js <TOKEN> [TICKET_SERVICE_URL] [OPTIONS]
 *
 * Options:
 *   --include-list        Include full list of synced users (default: sample only)
 *   --list-limit=<number> Limit number of users in list (default: 100)
 *
 * This script syncs only ENABLED users from Frappe for better performance.
 *
 * Example:
 *   node sync-all-users.js eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *   node sync-all-users.js <TOKEN> https://admin.sis.wellspring.edu.vn --include-list
 *   node sync-all-users.js <TOKEN> https://admin.sis.wellspring.edu.vn --include-list --list-limit=500
 */

const axios = require('axios');

const args = process.argv.slice(2);
const token = args[0];
const baseURL = args[1] || 'https://admin.sis.wellspring.edu.vn';

// Parse options
const includeList = args.includes('--include-list');
const listLimitArg = args.find(arg => arg.startsWith('--list-limit='));
const listLimit = listLimitArg ? parseInt(listLimitArg.split('=')[1]) : undefined;

if (!token) {
  console.error('❌ Error: Token required');
  console.error('Usage: node sync-all-users.js <TOKEN> [TICKET_SERVICE_URL] [OPTIONS]');
  console.error('');
  console.error('Options:');
  console.error('  --include-list        Include full list of synced users');
  console.error('  --list-limit=<number> Limit number of users in list');
  console.error('');
  console.error('Example:');
  console.error('  node sync-all-users.js eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
  console.error('  node sync-all-users.js <TOKEN> https://admin.sis.wellspring.edu.vn --include-list');
  console.error('  node sync-all-users.js <TOKEN> https://admin.sis.wellspring.edu.vn --include-list --list-limit=500');
  process.exit(1);
}

const syncAllUsers = async () => {
  try {
    // Build URL with query parameters
    let url = `${baseURL}/api/ticket/user/sync/manual`;
    const params = [];
    if (includeList) {
      params.push('include_list=true');
    }
    if (listLimit) {
      params.push(`list_limit=${listLimit}`);
    }
    if (params.length > 0) {
      url += '?' + params.join('&');
    }
    
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
        const { synced, failed, total, user_type_breakdown } = data.stats;
        console.log(`📊 Stats:`);
        console.log(`   ✅ Synced: ${synced}`);
        console.log(`   ❌ Failed: ${failed}`);
        console.log(`   📋 Total:  ${total}`);
        
        if (user_type_breakdown) {
          console.log('');
          console.log(`📊 User Type Breakdown:`);
          console.log(`   - System Users: ${user_type_breakdown['System User'] || 0}`);
          console.log(`   - Website Users: ${user_type_breakdown['Website User'] || 0}`);
          console.log(`   - Other: ${user_type_breakdown['Other'] || 0}`);
        }
      }
      
      // Show synced users list
      const usersList = data.synced_users || data.synced_users_sample || [];
      if (usersList.length > 0) {
        console.log('');
        console.log(`📝 Synced Users (${data.synced_users_total || usersList.length} total):`);
        usersList.forEach((user, idx) => {
          console.log(`   ${idx + 1}. ${user.fullname || user.email} (${user.email}) [${user.userType || 'Unknown'}]`);
          if (user.roles && user.roles.length > 0) {
            console.log(`      Roles: ${user.roles.join(', ')}`);
          }
        });
        
        if (data.synced_users_note) {
          console.log('');
          console.log(`ℹ️  ${data.synced_users_note}`);
        }
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
