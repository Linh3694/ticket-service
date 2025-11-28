const { getServiceAuthHeaders, createServiceToken } = require('./utils/jwtHelper');
const axios = require('axios');
require('dotenv').config({ path: './config.env' });

async function testJWTIntegration() {
  try {
    console.log('🧪 Testing JWT integration between ticket-service and Frappe...');

    // Test 1: Create JWT token
    console.log('\n1️⃣ Testing JWT token creation...');
    const token = createServiceToken();
    console.log('✅ JWT token created successfully');
    console.log('Token preview:', token.substring(0, 50) + '...');

    // Test 2: Test headers generation
    console.log('\n2️⃣ Testing auth headers generation...');
    const headers = getServiceAuthHeaders();
    console.log('✅ Auth headers created');
    console.log('Authorization header:', headers.Authorization.substring(0, 50) + '...');

    // Test 3: Send test event to Frappe
    console.log('\n3️⃣ Testing HTTP request to Frappe with JWT...');

    const frappeApiUrl = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';
    const ticketEndpoint = `${frappeApiUrl}/api/method/erp.api.notification.ticket.handle_ticket_event`;

    const testEvent = {
      event_type: 'test_ticket_event',
      event_data: {
        ticketId: 'test-123',
        ticketCode: 'TEST-001',
        title: 'Test Ticket for JWT Integration',
        message: 'This is a test event to verify JWT authentication',
        timestamp: new Date().toISOString(),
        source: 'ticket-service-test'
      }
    };

    console.log('Sending test event to:', ticketEndpoint);
    console.log('Event data:', JSON.stringify(testEvent, null, 2));

    const response = await axios.post(ticketEndpoint, testEvent, {
      headers: headers,
      timeout: 30000
    });

    console.log('✅ Request successful!');
    console.log('Response status:', response.status);
    console.log('Response data:', response.data);

    if (response.data?.success) {
      console.log('🎉 JWT integration test PASSED!');
    } else {
      console.log('⚠️ Request succeeded but response indicates failure');
    }

  } catch (error) {
    console.error('❌ JWT integration test FAILED:');
    console.error('Error message:', error.message);

    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
      console.error('Response headers:', error.response.headers);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Request setup error:', error.message);
    }
  }
}

// Run the test
testJWTIntegration();
