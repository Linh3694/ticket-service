require('dotenv').config({ path: require('path').join(__dirname, '../config.env') });
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');

/**
 * Script để tìm và fix duplicate tickets từ cùng một email
 * Giữ lại ticket đầu tiên (oldest), xóa các ticket duplicate sau đó
 */
async function fixDuplicateEmailTickets() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    
    if (!mongoUri) {
      console.error('❌ MONGODB_URI not found in environment variables');
      console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('MONGO')));
      process.exit(1);
    }
    
    console.log(`   Using MongoDB URI: ${mongoUri.replace(/\/\/.*@/, '//*****@')}`);
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Tìm tất cả duplicate emailId
    console.log('\n🔍 Finding duplicate emailId...');
    const duplicates = await Ticket.aggregate([
      { $match: { emailId: { $exists: true, $ne: null } } },
      { 
        $group: { 
          _id: '$emailId', 
          count: { $sum: 1 }, 
          tickets: { 
            $push: { 
              id: '$_id', 
              ticketCode: '$ticketCode', 
              createdAt: '$createdAt',
              status: '$status'
            } 
          } 
        } 
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]);

    if (duplicates.length === 0) {
      console.log('✅ No duplicate emailId found');
      process.exit(0);
      return;
    }

    console.log(`\n⚠️  Found ${duplicates.length} duplicate emailId:\n`);

    let totalToDelete = 0;

    for (const dup of duplicates) {
      console.log(`📧 EmailId: ${dup._id}`);
      console.log(`   Total tickets: ${dup.count}`);
      
      // Sort tickets by createdAt (oldest first)
      const sortedTickets = dup.tickets.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );

      // Giữ lại ticket đầu tiên (oldest)
      const keepTicket = sortedTickets[0];
      const deleteTickets = sortedTickets.slice(1);

      console.log(`   ✅ Keep: ${keepTicket.ticketCode} (${new Date(keepTicket.createdAt).toISOString()}) [${keepTicket.status}]`);
      
      for (const ticket of deleteTickets) {
        console.log(`   ❌ Delete: ${ticket.ticketCode} (${new Date(ticket.createdAt).toISOString()}) [${ticket.status}]`);
        totalToDelete++;
      }
      console.log('');
    }

    // Xác nhận trước khi xóa
    console.log(`\n⚠️  Total tickets to delete: ${totalToDelete}`);
    console.log('⚠️  This action cannot be undone!\n');

    // Nếu bạn muốn tự động xóa, uncomment đoạn code dưới
    // CẢNH BÁO: Chỉ uncomment khi bạn đã review kỹ danh sách tickets sẽ bị xóa
    
    /*
    console.log('🔄 Deleting duplicate tickets...');
    
    for (const dup of duplicates) {
      const sortedTickets = dup.tickets.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );
      
      const deleteTickets = sortedTickets.slice(1);
      const deleteIds = deleteTickets.map(t => t.id);
      
      const result = await Ticket.deleteMany({ _id: { $in: deleteIds } });
      console.log(`✅ Deleted ${result.deletedCount} tickets for emailId: ${dup._id}`);
    }
    
    console.log('\n✅ All duplicate tickets deleted successfully');
    */

    console.log('ℹ️  To delete these tickets, uncomment the deletion code in the script');
    console.log('ℹ️  File: scripts/fix-duplicate-email-tickets.js');

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Chạy script
fixDuplicateEmailTickets();






