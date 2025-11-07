/**
 * Test script for authentication middleware
 * Run with: node test_auth.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5001'; // Adjust if needed
const TEST_TOKEN = process.env.TEST_FRAPPE_TOKEN || 'your_test_token_here';

async function testAuth() {
  console.log('🧪 Testing Ticket Service Authentication...\n');

  // Test 1: No token
  console.log('📋 Test 1: No Authorization header');
  try {
    const response = await axios.get(`${BASE_URL}/api/ticket/my-tickets`);
    console.log('❌ Expected 401, but got:', response.status);
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Correctly returned 401 for missing token');
    } else {
      console.log('❌ Unexpected response:', error.response?.status, error.response?.data);
    }
  }

  console.log('\n📋 Test 2: Invalid token');
  try {
    const response = await axios.get(`${BASE_URL}/api/ticket/my-tickets`, {
      headers: { 'Authorization': 'Bearer invalid_token' }
    });
    console.log('❌ Expected 401, but got:', response.status);
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Correctly returned 401 for invalid token');
    } else {
      console.log('❌ Unexpected response:', error.response?.status, error.response?.data);
    }
  }

  if (TEST_TOKEN && TEST_TOKEN !== 'your_test_token_here') {
    console.log('\n📋 Test 3: Valid token');
    try {
      const response = await axios.get(`${BASE_URL}/api/ticket/my-tickets`, {
        headers: { 'Authorization': `Bearer ${TEST_TOKEN}` }
      });
      console.log('✅ Successfully authenticated with token');
      console.log('📊 Response:', response.data);
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('❌ Token validation failed:', error.response?.data);
      } else {
        console.log('❌ Unexpected error:', error.response?.status, error.response?.data);
      }
    }
  } else {
    console.log('\n⚠️  Skipping valid token test - set TEST_FRAPPE_TOKEN in environment');
  }

  console.log('\n🏁 Authentication tests completed');
}

// Run tests
testAuth().catch(console.error);
