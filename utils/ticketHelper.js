const Ticket = require('../models/Ticket');
const SupportTeamMember = require('../models/SupportTeamMember');

/**
 * Danh sách mapping giữa category và ticket code prefix
 */
const CATEGORY_PREFIXES = {
  'Overall': 'OVR',
  'Vấn đề chung': 'OVR', // Vietnamese name for Overall
  'Camera': 'CAM',
  'Camera System': 'CAM', // Alternative name for Camera
  'Hệ thống camera': 'CAM', // Vietnamese name for Camera
  'Network': 'NW',
  'Network System': 'NW', // Alternative name for Network
  'Hệ thống mạng': 'NW', // Vietnamese name for Network
  'Bell System': 'PA',
  'Hệ thống chuông báo': 'PA', // Vietnamese name for Bell System
  'Software': 'SW',
  'Hệ thống phần mềm': 'SW', // Vietnamese name for Software
  'Account': 'ACC',
  'Tài khoản': 'ACC' // Vietnamese name for Account
};

/**
 * Mapping giữa category và role để tìm team member
 */
const CATEGORY_TO_ROLE = {
  'Overall': 'Overall',
  'Vấn đề chung': 'Overall',
  'Camera': 'Camera System',
  'Camera System': 'Camera System',
  'Hệ thống camera': 'Camera System',
  'Network': 'Network System',
  'Network System': 'Network System',
  'Hệ thống mạng': 'Network System',
  'Bell System': 'Bell System',
  'Hệ thống chuông báo': 'Bell System',
  'Software': 'Software',
  'Hệ thống phần mềm': 'Software',
  'Account': 'Account',
  'Tài khoản': 'Account'
};

/**
 * Generate ticket code dựa trên category
 * Ví dụ: OVR-0001, CAM-0002, etc.
 */
async function generateTicketCode(category) {
  try {
    const prefix = CATEGORY_PREFIXES[category];
    if (!prefix) {
      throw new Error(`Invalid category: ${category}`);
    }

    // Lấy ticket cuối cùng với prefix này
    const lastTicket = await Ticket.findOne({
      ticketCode: { $regex: `^${prefix}-` }
    }).sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastTicket && lastTicket.ticketCode) {
      const match = lastTicket.ticketCode.match(/(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const ticketCode = `${prefix}-${String(nextNumber).padStart(4, '0')}`;
    console.log(`✅ Generated ticket code: ${ticketCode}`);
    return ticketCode;
  } catch (error) {
    console.error('❌ Error generating ticket code:', error.message);
    throw error;
  }
}

/**
 * Tìm người phụ trách có role tương ứng với ít nhất ticket
 * Load balancing: assign cho người có ít ticket nhất
 */
async function assignTicketToUser(category) {
  try {
    // Map category to role for team member lookup
    const role = CATEGORY_TO_ROLE[category] || category;
    console.log(`🔍 [assignTicket] Finding team member with role: ${role} (from category: ${category})`);

    // Sử dụng static method getMembersByRole (auto-populates user data)
    const teamMembers = await SupportTeamMember.getMembersByRole(role);

    console.log(`   📋 Query: roles=${role}, isActive=true`);
    console.log(`   ✅ Found ${teamMembers.length} team member(s)`);

    if (teamMembers.length === 0) {
      console.warn(`⚠️  [assignTicket] No team member found for role: ${role}`);
      return null;
    }

    teamMembers.forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.fullname} (${m.email}) - roles: ${m.roles.join(', ')}`);
    });

    // Nếu chỉ có 1 người, assign cho họ
    if (teamMembers.length === 1) {
      const assignedMember = teamMembers[0];
      console.log(`✅ [assignTicket] Assigned to: ${assignedMember.fullname} (only 1 member)`);
      console.log(`   Member ID: ${assignedMember._id}`);
      return assignedMember._id;
    }

    // Nếu có nhiều người, tìm người có ít ticket nhất (load balancing)
    console.log(`   🔄 Load balancing: counting tickets for each member...`);
    const memberStats = await Promise.all(
      teamMembers.map(async (member) => {
        const Ticket = require('../models/Ticket');
        const ticketCount = await Ticket.countDocuments({
          assignedTo: member._id,
          status: { $in: ['Assigned', 'Processing'] }
        });
        console.log(`   - ${member.fullname}: ${ticketCount} active tickets`);
        return { memberId: member._id, name: member.fullname, ticketCount };
      })
    );

    // Sắp xếp theo số ticket (tăng dần)
    memberStats.sort((a, b) => a.ticketCount - b.ticketCount);

    const selected = memberStats[0];
    console.log(`✅ [assignTicket] Assigned to: ${selected.name} (${selected.ticketCount} active tickets)`);
    console.log(`   Member ID: ${selected.memberId}`);
    return selected.memberId;
  } catch (error) {
    console.error('❌ Error assigning ticket:', error.message);
    console.error('   Stack:', error.stack);
    return null;
  }
}

/**
 * Log ticket history
 */
async function logTicketHistory(ticketId, action, userId) {
  try {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    ticket.history = ticket.history || [];
    ticket.history.push({
      timestamp: new Date(),
      action,
      user: userId
    });

    await ticket.save();
    console.log(`📝 [logHistory] Logged: ${action}`);
  } catch (error) {
    console.error('❌ Error logging history:', error.message);
  }
}

module.exports = {
  generateTicketCode,
  assignTicketToUser,
  logTicketHistory,
  CATEGORY_PREFIXES,
  CATEGORY_TO_ROLE
};
