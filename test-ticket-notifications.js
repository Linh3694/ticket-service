/**
 * Test script for ticket state change notifications
 * Run with: node test-ticket-notifications.js
 */

// Mock the notification service for testing without database
const mockNotificationService = {
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

    // Mock recipients logic
    if (ticket.assignedTo) {
      recipients.add(ticket.assignedTo);
    }

    if (ticket.creator && (!ticket.assignedTo || status === 'Done' || status === 'Closed' || status === 'Waiting for Customer' || status === 'Cancelled')) {
      recipients.add(ticket.creator);
    }

    return Array.from(recipients);
  },

  getSupportTeamRecipients: async (category) => {
    // Mock support team recipients
    return ['user1', 'user2', 'user3'];
  },

  sendNewTicketToSupportTeamNotification: async (ticket) => {
    console.log('✅ [Mock] Sent new ticket notification to support team:', ticket.ticketCode);
    return true;
  },

  sendUserReplyNotification: async (ticket, user) => {
    console.log('✅ [Mock] Sent user reply notification for:', ticket.ticketCode);
    return true;
  },

  sendTicketCancelledNotification: async (ticket, cancelledBy) => {
    console.log('✅ [Mock] Sent ticket cancelled notification for:', ticket.ticketCode);
    return true;
  },

  sendTicketFeedbackNotification: async (ticket, feedback) => {
    console.log('✅ [Mock] Sent feedback notification for:', ticket.ticketCode, feedback.rating, 'stars');
    return true;
  }
};

// Test data
const testUsers = [
  {
    email: 'test-user-1@sis.wellspring.edu.vn',
    fullname: 'Test User 1',
    role: 'technical',
    deviceToken: 'ExponentPushToken[test-token-1]'
  },
  {
    email: 'test-user-2@sis.wellspring.edu.vn',
    fullname: 'Test User 2',
    role: 'technical',
    deviceToken: 'ExponentPushToken[test-token-2]'
  }
];

const testTicket = {
  ticketCode: 'TEST-001',
  title: 'Test Ticket for Notifications',
  description: 'This is a test ticket for notification testing',
  category: 'Software',
  priority: 'High',
  status: 'Assigned'
};

async function setupTestData() {
  console.log('🔧 Setting up test data...');

  try {
    // Connect to database
    await mongoose.connect(process.env.DATABASE_URI || 'mongodb://localhost:27017/ticket-service-test');
    console.log('✅ Connected to database');

    // Create test users
    const users = [];
    for (const userData of testUsers) {
      let user = await User.findOne({ email: userData.email });
      if (!user) {
        user = new User(userData);
        await user.save();
        console.log(`✅ Created test user: ${user.email}`);
      }
      users.push(user);
    }

    // Create test ticket
    let ticket = await Ticket.findOne({ ticketCode: testTicket.ticketCode });
    if (!ticket) {
      ticket = new Ticket({
        ...testTicket,
        creator: users[0]._id,
        assignedTo: users[1]._id
      });
      await ticket.save();
      console.log(`✅ Created test ticket: ${ticket.ticketCode}`);
    }

    return { users, ticket };
  } catch (error) {
    console.error('❌ Error setting up test data:', error);
    throw error;
  }
}

async function testStatusChangeNotifications(ticket, users) {
  console.log('\n🧪 Testing status change notifications...');

  const statusChanges = [
    { from: 'Assigned', to: 'Processing' },
    { from: 'Processing', to: 'Waiting for Customer' },
    { from: 'Waiting for Customer', to: 'Done' },
    { from: 'Done', to: 'Closed' }
  ];

  for (const change of statusChanges) {
    console.log(`\n📝 Testing ${change.from} → ${change.to}...`);

    try {
      // Update ticket status
      ticket.status = change.to;
      await ticket.save();

      // Send notification
      await notificationService.sendTicketStatusChangeNotification(
        ticket,
        change.from,
        change.to,
        users[0]._id // changedBy
      );

      console.log(`✅ Notification sent for ${change.from} → ${change.to}`);
    } catch (error) {
      console.error(`❌ Error testing ${change.from} → ${change.to}:`, error.message);
    }

    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function testAssignmentNotification(ticket, users) {
  console.log('\n🧪 Testing assignment notification...');

  try {
    await notificationService.sendTicketAssignmentNotification(
      ticket,
      users[1], // assignedTo
      users[0]  // assignedBy
    );
    console.log('✅ Assignment notification sent');
  } catch (error) {
    console.error('❌ Error testing assignment notification:', error.message);
  }
}

async function testAdminNotifications(ticket, users) {
  console.log('\n🧪 Testing admin notifications...');

  // Test new ticket to support team
  try {
    await notificationService.sendNewTicketToSupportTeamNotification(ticket);
    console.log('✅ New ticket to support team notification sent');
  } catch (error) {
    console.error('❌ Error testing new ticket notification:', error.message);
  }

  // Test user reply notification
  try {
    await notificationService.sendUserReplyNotification(ticket, users[0]);
    console.log('✅ User reply notification sent');
  } catch (error) {
    console.error('❌ Error testing user reply notification:', error.message);
  }

  // Test ticket cancelled notification
  try {
    await notificationService.sendTicketCancelledNotification(ticket, users[0]);
    console.log('✅ Ticket cancelled notification sent');
  } catch (error) {
    console.error('❌ Error testing cancelled notification:', error.message);
  }

  // Test feedback notification
  try {
    const feedbackData = {
      rating: 5,
      comment: 'Excellent service!',
      badges: ['Nhiệt Huyết', 'Chu Đáo']
    };
    await notificationService.sendTicketFeedbackNotification(ticket, feedbackData);
    console.log('✅ Feedback notification sent');
  } catch (error) {
    console.error('❌ Error testing feedback notification:', error.message);
  }
}

async function testNotificationRecipients(ticket, users) {
  console.log('\n🧪 Testing notification recipients logic...');

  const testStatuses = ['Assigned', 'Processing', 'Waiting for Customer', 'Done', 'Closed', 'Cancelled'];

  for (const status of testStatuses) {
    const recipients = notificationService.getTicketNotificationRecipients(ticket, status);
    console.log(`📋 Recipients for status "${status}": ${recipients.length} users`);
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');

  try {
    // Remove test ticket
    await Ticket.findOneAndDelete({ ticketCode: testTicket.ticketCode });
    console.log('✅ Removed test ticket');

    // Remove test users
    for (const userData of testUsers) {
      await User.findOneAndDelete({ email: userData.email });
      console.log(`✅ Removed test user: ${userData.email}`);
    }

    // Close database connection
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error cleaning up:', error);
  }
}

async function runTests() {
  console.log('🚀 Starting ticket notification tests...\n');

  try {
    const { users, ticket } = await setupTestData();

    await testNotificationRecipients(ticket, users);
    await testStatusChangeNotifications(ticket, users);
    await testAssignmentNotification(ticket, users);
    await testAdminNotifications(ticket, users);

    console.log('\n✅ All tests completed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    await cleanup();
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  setupTestData,
  testStatusChangeNotifications,
  testAssignmentNotification,
  testNotificationRecipients,
  cleanup,
  runTests
};
