const axios = require('axios');
require("dotenv").config({ path: './config.env' });

const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

console.log('🔍 Simple Frappe Connection Test');
console.log(`📍 URL: ${FRAPPE_API_URL}`);
console.log('─'.repeat(40));

async function simpleTest() {
  try {
    console.log('Testing basic connection...');
    
    // Test 1: Just check if server responds
    const response = await axios.get(FRAPPE_API_URL, {
      timeout: 5000,
      headers: {
        'Accept': 'text/html,application/json'
      }
    });
    
    console.log('✅ Server is reachable!');
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${response.headers['content-type']}`);
    
    // Test 2: Try a simple API endpoint
    try {
      const apiResponse = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.ping`, {
        timeout: 3000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('✅ API endpoint accessible!');
      console.log(`API Status: ${apiResponse.status}`);
      
    } catch (apiError) {
      if (apiError.response?.status === 401) {
        console.log('✅ API endpoint accessible (requires auth - expected)');
      } else {
        console.log('⚠️ API endpoint test failed, but server is reachable');
        console.log(`API Error: ${apiError.message}`);
      }
    }
    
  } catch (error) {
    console.log('❌ Connection failed!');
    console.log(`Error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Tip: Frappe server might not be running');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 Tip: Check if the URL is correct');
    } else if (error.response?.status === 417) {
      console.log('💡 Tip: Try adding proper headers or check server configuration');
    }
  }
}

simpleTest(); 