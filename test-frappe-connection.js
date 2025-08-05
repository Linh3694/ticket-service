const axios = require('axios');
require("dotenv").config({ path: './config.env' });

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

console.log('🔍 Testing Frappe Connection...');
console.log(`📍 Frappe API URL: ${FRAPPE_API_URL}`);
console.log('─'.repeat(50));

// Test 1: Basic connectivity
async function testBasicConnectivity() {
  console.log('1️⃣ Testing basic connectivity...');
  try {
    const response = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.auth.get_logged_user`, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Basic connectivity: SUCCESS');
    console.log(`   Response status: ${response.status}`);
    return true;
  } catch (error) {
    console.log('❌ Basic connectivity: FAILED');
    console.log(`   Error: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

// Test 2: Authentication with invalid token
async function testAuthentication() {
  console.log('\n2️⃣ Testing authentication with invalid token...');
  try {
    const response = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.auth.get_logged_user`, {
      timeout: 5000,
      headers: {
        'Authorization': 'Bearer invalid_token_123',
        'X-Frappe-CSRF-Token': 'invalid_token_123',
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Authentication endpoint accessible');
    console.log(`   Response status: ${response.status}`);
    return true;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log('✅ Authentication endpoint accessible (expected 401 for invalid token)');
      console.log(`   Status: ${error.response.status}`);
      return true;
    } else {
      console.log('❌ Authentication test: FAILED');
      console.log(`   Error: ${error.message}`);
      return false;
    }
  }
}

// Test 3: Check Frappe system info
async function testSystemInfo() {
  console.log('\n3️⃣ Testing system info endpoint...');
  try {
    const response = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.utils.get_system_info`, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ System info: SUCCESS');
    console.log(`   Response status: ${response.status}`);
    if (response.data && response.data.message) {
      console.log(`   Frappe version: ${response.data.message.version || 'Unknown'}`);
    }
    return true;
  } catch (error) {
    console.log('❌ System info: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

// Test 4: Test with valid token (if provided)
async function testWithValidToken() {
  const validToken = process.env.TEST_FRAPPE_TOKEN;
  if (!validToken) {
    console.log('\n4️⃣ Testing with valid token: SKIPPED (no TEST_FRAPPE_TOKEN provided)');
    console.log('   To test with valid token, add TEST_FRAPPE_TOKEN to your config.env');
    return true;
  }

  console.log('\n4️⃣ Testing with valid token...');
  try {
    const response = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.auth.get_logged_user`, {
      timeout: 5000,
      headers: {
        'Authorization': `Bearer ${validToken}`,
        'X-Frappe-CSRF-Token': validToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data && response.data.message) {
      console.log('✅ Valid token test: SUCCESS');
      console.log(`   Logged user: ${response.data.message}`);
      
      // Test getting user details
      const userResponse = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${response.data.message}`, {
        headers: {
          'Authorization': `Bearer ${validToken}`,
          'X-Frappe-CSRF-Token': validToken
        }
      });
      
      if (userResponse.data && userResponse.data.data) {
        const user = userResponse.data.data;
        console.log(`   User details: ${user.full_name || user.name} (${user.email})`);
      }
    } else {
      console.log('❌ Valid token test: FAILED - No user returned');
    }
    return true;
  } catch (error) {
    console.log('❌ Valid token test: FAILED');
    console.log(`   Error: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
    }
    return false;
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Frappe connection tests...\n');
  
  const results = {
    basicConnectivity: await testBasicConnectivity(),
    authentication: await testAuthentication(),
    systemInfo: await testSystemInfo(),
    validToken: await testWithValidToken()
  };

  console.log('\n' + '─'.repeat(50));
  console.log('📊 Test Results Summary:');
  console.log(`   Basic Connectivity: ${results.basicConnectivity ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Authentication: ${results.authentication ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   System Info: ${results.systemInfo ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Valid Token: ${results.validToken ? '✅ PASS' : '⚠️ SKIP'}`);
  
  const passedTests = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;
  
  console.log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Frappe connection is working properly.');
  } else {
    console.log('⚠️ Some tests failed. Please check your Frappe configuration.');
  }
  
  console.log('\n💡 Tips:');
  console.log('   - Make sure Frappe server is running');
  console.log('   - Check if FRAPPE_API_URL is correct');
  console.log('   - Verify network connectivity between services');
  console.log('   - Add TEST_FRAPPE_TOKEN to config.env for full authentication test');
}

// Run tests
runTests().catch(console.error); 