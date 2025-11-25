const mongoose = require('mongoose');
const SupportTeamMember = require('./models/SupportTeamMember');
const Ticket = require('./models/Ticket');

async function debugAssign() {
  try {
    // Kết nối database
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/ticket_service';
    await mongoose.connect(mongoUrl);

    console.log('🔍 [DEBUG] Checking SupportTeamMembers...');

    // 1. Kiểm tra tất cả members
    const allMembers = await SupportTeamMember.find({}).lean();
    console.log(`📋 Total SupportTeamMembers: ${allMembers.length}`);

    allMembers.forEach((m, i) => {
      console.log(`  ${i+1}. ${m.email} - Active: ${m.isActive} - Roles: [${m.roles.join(', ')}]`);
    });

    // 2. Kiểm tra members với role Overall
    console.log('\n🔍 [DEBUG] Checking members with Overall role...');
    const overallMembers = await SupportTeamMember.find({
      roles: 'Overall',
      isActive: true
    }).lean();

    console.log(`📋 Found ${overallMembers.length} active members with Overall role:`);
    overallMembers.forEach((m, i) => {
      console.log(`  ${i+1}. ${m.email} - Roles: [${m.roles.join(', ')}]`);
    });

    // 3. Test populate
    if (overallMembers.length > 0) {
      console.log('\n🔍 [DEBUG] Testing populateUserData...');
      const populated = await SupportTeamMember.populateUserData(overallMembers);
      populated.forEach((m, i) => {
        console.log(`  ${i+1}. ${m.fullname} (${m.email}) - userId: ${m.userId}`);
      });
    }

    // 4. Kiểm tra ticket hiện tại
    console.log('\n🔍 [DEBUG] Checking ticket OVR-0001...');
    const ticket = await Ticket.findOne({ ticketCode: 'OVR-0001' }).lean();
    if (ticket) {
      console.log(`  Ticket found: ${ticket._id}`);
      console.log(`  Category: ${ticket.category}`);
      console.log(`  AssignedTo: ${ticket.assignedTo || 'null'}`);
      console.log(`  Status: ${ticket.status}`);
    } else {
      console.log('  Ticket not found!');
    }

    await mongoose.disconnect();
    console.log('\n✅ Debug completed');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugAssign();
