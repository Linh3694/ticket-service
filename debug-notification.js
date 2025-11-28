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
  } catch (error) {
    console.log('❌ Notification service not reachable:');
    console.log('   Error:', error.code || error.message);
    console.log('   URL: http://172.16.20.115:5001/health');

    if (error.code === 'ECONNREFUSED') {
      console.log('   → Service is not running or firewall blocking');
    } else if (error.code === 'ENOTFOUND') {
      console.log('   → DNS resolution failed - check network connectivity');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('   → Connection timeout - service may be slow or unreachable');
    }
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
  } catch (error) {
    console.log('❌ Ticket service not reachable:');
    console.log('   Error:', error.code || error.message);
    console.log('   URL: http://172.16.20.113:5001/health');

    if (error.code === 'ECONNREFUSED') {
      console.log('   → Service is not running');
    }
  }
}

async function runConnectivityTests() {
  console.log('🔍 Running connectivity tests...\n');

  await testNotificationService();
  console.log();
  await testTicketService();

  console.log('\n💡 Next steps:');
  console.log('1. If services are not running, start them:');
  console.log('   cd ticket-service && npm start');
  console.log('   # Start notification service similarly');
  console.log('2. Check device tokens in database');
  console.log('3. Test actual ticket state change');
  console.log('4. Check mobile app logs for received notifications');
}

// Run connectivity tests
runConnectivityTests().catch(console.error);
