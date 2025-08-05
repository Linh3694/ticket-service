const axios = require('axios');
require("dotenv").config({ path: './config.env' });

const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

console.log('🔍 Quick Frappe Connection Test');
console.log(`📍 URL: ${FRAPPE_API_URL}`);
console.log('─'.repeat(40));

async function testEndpoint(url, description) {
  try {
    console.log(`Testing: ${description}`);
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    console.log(`✅ ${description}: SUCCESS (${response.status})`);
    return true;
  } catch (error) {
    console.log(`❌ ${description}: FAILED`);
    console.log(`   Status: ${error.response?.status || 'Unknown'}`);
    console.log(`   Error: ${error.message}`);
    
    if (error.response?.status === 401) {
      console.log('   💡 Expected - endpoint requires authentication');
      return true; // 401 is expected for protected endpoints
    }
    
    return false;
  }
}

async function quickTest() {
  console.log('Testing multiple endpoints...\n');
  
  const tests = [
    {
      url: `${FRAPPE_API_URL}/api/method/frappe.utils.get_system_info`,
      description: 'System Info (requires auth)'
    },
    {
      url: `${FRAPPE_API_URL}/api/method/frappe.auth.get_logged_user`,
      description: 'Get Logged User (requires auth)'
    },
    {
      url: `${FRAPPE_API_URL}/api/method/frappe.ping`,
      description: 'Ping (public)'
    },
    {
      url: `${FRAPPE_API_URL}/api/method/frappe.utils.get_site_info`,
      description: 'Site Info (public)'
    },
    {
      url: `${FRAPPE_API_URL}/api/method/frappe.utils.get_versions`,
      description: 'Get Versions (public)'
    }
  ];

  let successCount = 0;
  
  for (const test of tests) {
    const result = await testEndpoint(test.url, test.description);
    if (result) successCount++;
    console.log(''); // Add spacing
  }

  console.log('─'.repeat(40));
  console.log(`📊 Results: ${successCount}/${tests.length} endpoints accessible`);
  
  if (successCount > 0) {
    console.log('✅ Frappe server is reachable!');
    console.log('💡 Some endpoints require authentication (401 is normal)');
  } else {
    console.log('❌ No endpoints are accessible');
    console.log('💡 Check if Frappe server is running and URL is correct');
  }
}

quickTest(); 