/**
 * Debug script to check ticket recipients for a specific ticket
 * Run with: node debug-ticket-recipients.js <ticketId>
 */

const mongoose = require('mongoose');
const Ticket = require('./models/Ticket');
const User = require('./models/Users');
require('dotenv').config({ path: './config.env' });

// Mock notification service methods for testing
const mockNotificationService = {
  getTicketNotificationRecipients: function(ticket, status = null) {
    const recipients = new Set();

    console.log('🔍 Analyzing ticket for recipients:');
    console.log(`   Ticket ID: ${ticket._id}`);
    console.log(`   Ticket Code: ${ticket.ticketCode}`);
    console.log(`   Status: ${ticket.status}`);
    console.log(`   Assigned To: ${ticket.assignedTo}`);
    console.log(`   Creator: ${ticket.creator}`);
    console.log(`   Status param: ${status}`);

    // Thêm assignee hiện tại
    if (ticket.assignedTo) {
      const assigneeId = ticket.assignedTo._id || ticket.assignedTo;
      if (assigneeId) {
        recipients.add(assigneeId);
        console.log(`   ✅ Added assignee: ${assigneeId}`);
      } else {
        console.log('   ❌ Assignee is null/undefined');
      }
    } else {
      console.log('   ⚠️  No assignee assigned');
    }

    // Status-specific recipient logic
    const creator = ticket.createdBy || ticket.creator;
    const creatorId = creator?._id || creator;

    if (status) {
      console.log(`   📋 Status-specific logic for: ${status}`);
      switch (status) {
        case 'Done':
        case 'Closed':
          // Gửi cho creator khi ticket hoàn thành/đóng
          if (creatorId) {
            recipients.add(creatorId);
            console.log(`   ✅ Added creator for completion: ${creatorId}`);
          }
          break;

        case 'Waiting for Customer':
          // Gửi cho creator khi cần phản hồi
          if (creatorId) {
            recipients.add(creatorId);
            console.log(`   ✅ Added creator for waiting: ${creatorId}`);
          }
          break;

        case 'Cancelled':
          // Có thể gửi cho creator khi ticket bị hủy
          if (creatorId) {
            recipients.add(creatorId);
            console.log(`   ✅ Added creator for cancellation: ${creatorId}`);
          }
          break;

        default:
          // Cho các status khác, không gửi cho creator trừ khi họ là assignee
          if (creatorId && !ticket.assignedTo) {
            console.log(`   ⚠️  Creator filtered out (not assignee): ${creatorId}`);
          } else {
            console.log(`   ℹ️  Creator kept (is assignee or status allows): ${creatorId}`);
          }
          break;
      }
    } else {
      // Không gửi cho creator trừ khi họ là assignee (default behavior)
      if (creatorId && !ticket.assignedTo) {
        console.log(`   ⚠️  Creator filtered out (default rule): ${creatorId}`);
      } else {
        console.log(`   ℹ️  Creator kept (is assignee): ${creatorId}`);
      }
    }

    // Convert to array and filter out null/undefined values
    const finalRecipients = Array.from(recipients).filter(id => id != null);
    console.log(`   📨 Final recipients: ${finalRecipients.length} user(s)`);
    console.log(`      ${JSON.stringify(finalRecipients)}`);

    return finalRecipients;
  }
};

async function debugTicketRecipients(ticketId) {
  try {
    console.log(`🔍 Debugging recipients for ticket: ${ticketId}\n`);

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || process.env.DATABASE_URI || 'mongodb://localhost:27017/wellspring_tickets');
    console.log('✅ Connected to database');

    // Find the ticket
    const ticket = await Ticket.findById(ticketId)
      .populate('creator', 'email fullname')
      .populate('assignedTo', 'email fullname')
      .lean();

    if (!ticket) {
      console.log('❌ Ticket not found');
      return;
    }

    console.log('📋 Ticket Details:');
    console.log(`   ID: ${ticket._id}`);
    console.log(`   Code: ${ticket.ticketCode}`);
    console.log(`   Title: ${ticket.title}`);
    console.log(`   Status: ${ticket.status}`);
    console.log(`   Creator: ${ticket.creator ? `${ticket.creator.fullname} (${ticket.creator.email})` : 'None'}`);
    console.log(`   Assigned To: ${ticket.assignedTo ? `${ticket.assignedTo.fullname} (${ticket.assignedTo.email})` : 'None'}`);
    console.log();

    // Test recipients for current status
    console.log('🎯 Testing recipients for current status:');
    const currentRecipients = mockNotificationService.getTicketNotificationRecipients(ticket, ticket.status);
    console.log();

    // Test recipients for "Done" status (the one from logs)
    console.log('🎯 Testing recipients for "Done" status (from logs):');
    const doneRecipients = mockNotificationService.getTicketNotificationRecipients(ticket, 'Done');
    console.log();

    // Check if users exist in database
    console.log('👥 Checking user existence in database:');
    const userIdsToCheck = [...new Set([...currentRecipients, ...doneRecipients])];

    for (const userId of userIdsToCheck) {
      try {
        const user = await User.findById(userId).select('email fullname deviceToken').lean();
        if (user) {
          console.log(`   ✅ User ${userId}: ${user.fullname} (${user.email})`);
          console.log(`      Has device token: ${user.deviceToken ? '✅' : '❌'}`);
          if (user.deviceToken) {
            console.log(`      Token: ${user.deviceToken}`);
          }
        } else {
          console.log(`   ❌ User ${userId}: NOT FOUND in database`);
        }
      } catch (error) {
        console.log(`   ❌ Error checking user ${userId}:`, error.message);
      }
    }

  } catch (error) {
    console.error('❌ Error debugging ticket recipients:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// Get ticket ID from command line argument
const ticketId = process.argv[2];
if (!ticketId) {
  console.log('❌ Please provide a ticket ID as argument');
  console.log('   Example: node debug-ticket-recipients.js 6926989f45240ebd2c77f416');
  process.exit(1);
}

debugTicketRecipients(ticketId).catch(console.error);
