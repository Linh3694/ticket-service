#!/usr/bin/env node

/**
 * 🔍 Debug Test Script
 * Usage: node test-debug.js <TOKEN>
 */

const axios = require('axios');

const args = process.argv.slice(2);
const token = args[0];

if (!token) {
  console.error('❌ Error: Token required');
  console.error('Usage: node test-debug.js <TOKEN>');
  process.exit(1);
}

const testDebug = async () => {
  try {
    const url = 'https://admin.sis.wellspring.edu.vn/api/ticket/user/debug/fetch-users';

    console.log('🔍 Testing debug endpoint...');
    console.log(`URL: ${url}`);
    console.log('');

    const response = await axios.get(url, {
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
      console.log('✅ Debug test completed successfully!');
    } else {
      console.log(`❌ Debug test failed: ${data.message}`);
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

testDebug();
