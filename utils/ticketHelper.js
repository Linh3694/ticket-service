const Ticket = require('../models/Ticket');
const SupportTeamMember = require('../models/SupportTeamMember');

/**
 * Danh sách mapping giữa category và ticket code prefix
 */
const CATEGORY_PREFIXES = {
  'Overall': 'OVR',
  'Camera': 'CAM',
  'Network': 'NW',
  'Bell System': 'PA',
  'Software': 'SW',
  'Account': 'ACC'
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
    console.log(`🔍 [assignTicket] Finding team member with role: ${category}`);

    // Tìm tất cả team member có role tương ứng
    const teamMembers = await SupportTeamMember.find({
      roles: category,
      isActive: true
    });

    if (teamMembers.length === 0) {
      console.warn(`⚠️  [assignTicket] No team member found for role: ${category}`);
      return null;
    }

    console.log(`   Found ${teamMembers.length} team member(s) with role: ${category}`);

    // Nếu chỉ có 1 người, assign cho họ
    if (teamMembers.length === 1) {
      console.log(`✅ [assignTicket] Assigned to: ${teamMembers[0].fullname}`);
      return teamMembers[0]._id;
    }

    // Nếu có nhiều người, tìm người có ít ticket nhất (load balancing)
    const memberStats = await Promise.all(
      teamMembers.map(async (member) => {
        const ticketCount = await Ticket.countDocuments({
          assignedTo: member._id,
          status: { $in: ['Assigned', 'Processing'] } // Chỉ count ticket chưa hoàn thành
        });
        return { memberId: member._id, name: member.fullname, ticketCount };
      })
    );

    // Sắp xếp theo số ticket (tăng dần)
    memberStats.sort((a, b) => a.ticketCount - b.ticketCount);

    const selected = memberStats[0];
    console.log(`✅ [assignTicket] Assigned to: ${selected.name} (${selected.ticketCount} active tickets)`);
    return selected.memberId;
  } catch (error) {
    console.error('❌ Error assigning ticket:', error.message);
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
  CATEGORY_PREFIXES
};
