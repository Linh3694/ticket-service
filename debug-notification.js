/**
 * Debug script to test notification service without database
 */

console.log('🔧 Testing notification service...\n');

// Mock notification service methods
const notificationService = {
  getTicketStatusNotificationConfig: (status) => {
    const configs = {
      'Assigned': {
        title: '🎫 Ticket đã được gán',
        body: 'Ticket #{ticketCode} đã được gán cho bạn: {title}',
        priority: 'high',
        action: 'ticket_assigned'
      },
      'Processing': {
        title: '⚡ Ticket đang xử lý',
        body: 'Ticket #{ticketCode} đang được xử lý: {title}',
        priority: 'normal',
        action: 'ticket_processing'
      },
      'Waiting for Customer': {
        title: '⏳ Chờ phản hồi khách hàng',
        body: 'Ticket #{ticketCode} đang chờ phản hồi của bạn: {title}',
        priority: 'normal',
        action: 'ticket_waiting'
      },
      'Done': {
        title: '✅ Ticket đã hoàn thành',
        body: 'Ticket #{ticketCode} đã được giải quyết: {title}',
        priority: 'normal',
        action: 'ticket_done'
      },
      'Closed': {
        title: '🔒 Ticket đã đóng',
        body: 'Ticket #{ticketCode} đã được đóng: {title}',
        priority: 'low',
        action: 'ticket_closed'
      },
      'Cancelled': {
        title: '❌ Ticket đã hủy',
        body: 'Ticket #{ticketCode} đã bị hủy: {title}',
        priority: 'low',
        action: 'ticket_cancelled'
      }
    };
    return configs[status] || null;
  },

  getTicketNotificationRecipients: (ticket, status = null) => {
    const recipients = new Set();

    if (ticket.assignedTo) {
      recipients.add(ticket.assignedTo);
    }

    if (ticket.creator && (!ticket.assignedTo || ['Done', 'Closed', 'Waiting for Customer', 'Cancelled'].includes(status))) {
      recipients.add(ticket.creator);
    }

    return Array.from(recipients);
  }
};

// Test data
const mockTicket = {
  _id: '507f1f77bcf86cd799439011',
  ticketCode: 'TEST-001',
  title: 'Test Ticket for Debug',
  status: 'Assigned',
  assignedTo: 'user123',
  creator: 'creator456'
};

const mockUser = {
  _id: 'user789',
  fullname: 'Test User',
  email: 'test@example.com'
};

console.log('📋 Mock Ticket:', mockTicket);
console.log('👤 Mock User:', mockUser);
console.log();

// Test notification config
console.log('🔧 Testing notification configs:');
const statuses = ['Assigned', 'Processing', 'Waiting for Customer', 'Done', 'Closed', 'Cancelled'];
statuses.forEach(status => {
  const config = notificationService.getTicketStatusNotificationConfig(status);
  console.log(`  ${status}: ${config ? '✅ Config found' : '❌ No config'} - ${config?.title || 'N/A'}`);
});
console.log();

// Test recipients logic
console.log('👥 Testing recipients logic:');
statuses.forEach(status => {
  const recipients = notificationService.getTicketNotificationRecipients(mockTicket, status);
  console.log(`  ${status}: ${recipients.length} recipients - ${JSON.stringify(recipients)}`);
});
console.log();

// Test notification method calls
console.log('📱 Testing notification method signatures:');
try {
  const config = notificationService.getTicketStatusNotificationConfig('Processing');
  if (config) {
    const title = config.title;
    const body = config.body
      .replace('{ticketCode}', mockTicket.ticketCode)
      .replace('{title}', mockTicket.title);

    console.log('✅ Notification would be sent:');
    console.log(`   Title: ${title}`);
    console.log(`   Body: ${body}`);
    console.log(`   Action: ${config.action}`);
    console.log(`   Priority: ${config.priority}`);
  }
} catch (error) {
  console.log('❌ Error in notification logic:', error.message);
}

console.log('\n🎉 Debug test completed!');

// Test direct Expo push notification capability
console.log('\n📱 Testing direct Expo push notification capability...');

const { Expo } = require('expo-server-sdk');

async function testDirectPushNotification() {
  try {
    // Test Expo SDK
    const expo = new Expo();

    // Test token validation
    const testToken = 'ExponentPushToken[test-token-123]';
    const isValidToken = Expo.isExpoPushToken(testToken);

    console.log(`✅ Expo SDK loaded successfully`);
    console.log(`✅ Test token validation: ${isValidToken ? 'PASS' : 'FAIL'}`);

    // Test chunking (simulate sending to multiple devices)
    const messages = [
      {
        to: testToken,
        sound: 'default',
        title: 'Test Notification',
        body: 'This is a test push notification from ticket-service',
        data: { test: true }
      }
    ];

    const chunks = expo.chunkPushNotifications(messages);
    console.log(`✅ Message chunking works: ${chunks.length} chunk(s) created`);

    console.log('✅ Direct push notification capability: READY');

    return true;
  } catch (error) {
    console.log('❌ Direct push notification test failed:');
    console.log('   Error:', error.message);
    return false;
  }
}

// Test HTTP call to check if notification service is reachable
console.log('\n🌐 Testing notification service connectivity...');

const axios = require('axios');

async function testNotificationService() {
  try {
    const response = await axios.get('http://172.16.20.115:5001/health', {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Notification service is reachable:', response.status);
    console.log('   Response:', response.data);
    return true;
  } catch (error) {
    console.log('❌ Notification service not reachable:');
    console.log('   Error:', error.code || error.message);
    console.log('   → Will use direct push notifications instead');
    return false;
  }
}

async function testTicketService() {
  try {
    const response = await axios.get('http://172.16.20.113:5001/health', {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Ticket service is reachable:', response.status);
    console.log('   Response:', response.data);
    return true;
  } catch (error) {
    console.log('❌ Ticket service not reachable:');
    console.log('   Error:', error.code || error.message);
    return false;
  }
}

async function runConnectivityTests() {
  console.log('🔍 Running connectivity tests...\n');

  const [directPushOk, notificationServiceOk, ticketServiceOk] = await Promise.all([
    testDirectPushNotification(),
    testNotificationService(),
    testTicketService()
  ]);

  console.log('\n📊 Test Results Summary:');
  console.log(`   Direct Push Notifications: ${directPushOk ? '✅ READY' : '❌ FAILED'}`);
  console.log(`   External Notification Service: ${notificationServiceOk ? '✅ AVAILABLE' : '❌ UNAVAILABLE'}`);
  console.log(`   Ticket Service: ${ticketServiceOk ? '✅ RUNNING' : '❌ NOT RUNNING'}`);

  console.log('\n💡 Next steps:');

  if (directPushOk && ticketServiceOk) {
    console.log('✅ System is ready for direct push notifications!');
    console.log('1. Test actual ticket state change to trigger notifications');
    console.log('2. Check mobile device for received push notifications');
    console.log('3. Verify device tokens are properly stored in database');
  } else {
    if (!directPushOk) {
      console.log('❌ Fix Expo SDK issues before proceeding');
    }
    if (!ticketServiceOk) {
      console.log('❌ Start ticket service: cd ticket-service && npm start');
    }
  }

  console.log('\n🔧 Troubleshooting:');
  console.log('- Check device tokens in Users collection');
  console.log('- Verify Expo push tokens are valid');
  console.log('- Test with actual mobile device, not simulator');
  console.log('- Check mobile app notification permissions');
}

// Run connectivity tests
runConnectivityTests().catch(console.error);
