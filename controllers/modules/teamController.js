const SupportTeam = require("../../models/SupportTeam");
const SupportTeamMember = require("../../models/SupportTeamMember");
const User = require("../../models/Users");

/**
 * Get current user info
 */
const getMe = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId)
      .select('fullname email avatarUrl jobTitle department roles active disabled');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: user
    });

  } catch (error) {
    console.error('❌ Error fetching user info:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy thông tin người dùng'
    });
  }
};

/**
 * Get support team info
 */
const getSupportTeam = async (req, res) => {
  try {
    const teams = await SupportTeam.find()
      .populate('members', 'fullname email avatarUrl jobTitle department roles active disabled')
      .sort({ name: 1 });

    res.json({
      success: true,
      teams: teams
    });

  } catch (error) {
    console.error('❌ Error fetching support team:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy thông tin đội hỗ trợ'
    });
  }
};

/**
 * Add user to support team
 */
const addUserToSupportTeam = async (req, res) => {
  try {
    const { email, roles } = req.body;

    // Check if user exists
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Người dùng không tồn tại'
      });
    }

    // Check if user is already in support team
    const existingMember = await SupportTeamMember.findOne({ email: email });
    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: 'Người dùng đã có trong đội hỗ trợ'
      });
    }

    // Create support team member
    const member = new SupportTeamMember({
      userId: user._id,
      email: email,
      fullname: user.fullname,
      roles: roles || [],
      active: true
    });

    await member.save();

    // Update user roles if provided
    if (roles && roles.length > 0) {
      if (!user.roles) user.roles = [];
      roles.forEach(role => {
        if (!user.roles.includes(role)) {
          user.roles.push(role);
        }
      });
      await user.save();
    }

    res.json({
      success: true,
      message: 'Đã thêm người dùng vào đội hỗ trợ thành công',
      member: member
    });

  } catch (error) {
    console.error('❌ Error adding user to support team:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể thêm người dùng vào đội hỗ trợ'
    });
  }
};

/**
 * Remove user from support team
 */
const removeUserFromSupportTeam = async (req, res) => {
  try {
    const { email } = req.params;

    const member = await SupportTeamMember.findOne({ email: email });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Người dùng không có trong đội hỗ trợ'
      });
    }

    // Remove member
    await SupportTeamMember.findByIdAndDelete(member._id);

    res.json({
      success: true,
      message: 'Đã xóa người dùng khỏi đội hỗ trợ thành công'
    });

  } catch (error) {
    console.error('❌ Error removing user from support team:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể xóa người dùng khỏi đội hỗ trợ'
    });
  }
};

/**
 * Get ticket categories
 */
const getTicketCategories = async (req, res) => {
  try {
    // Get all unique categories from support team members
    const members = await SupportTeamMember.find({ active: true })
      .select('roles')
      .lean();

    const categories = new Set();

    // Map roles to categories
    members.forEach(member => {
      if (member.roles) {
        member.roles.forEach(role => {
          switch (role) {
            case 'Overall':
              categories.add('Tổng quát');
              break;
            case 'Software':
              categories.add('Phần mềm');
              break;
            case 'Network System':
              categories.add('Hệ thống mạng');
              break;
            case 'Camera System':
              categories.add('Hệ thống camera');
              break;
            case 'Bell System':
              categories.add('Hệ thống chuông');
              break;
            case 'Email Ticket':
              categories.add('Email Support');
              break;
          }
        });
      }
    });

    // Convert to array and sort
    const categoryList = Array.from(categories).sort();

    // Return as objects with value/label
    const result = categoryList.map(category => ({
      value: category,
      label: category
    }));

    // Fallback categories if no team members found
    if (result.length === 0) {
      result.push(
        { value: 'Tổng quát', label: 'Tổng quát' },
        { value: 'Phần mềm', label: 'Phần mềm' },
        { value: 'Hệ thống mạng', label: 'Hệ thống mạng' },
        { value: 'Hệ thống camera', label: 'Hệ thống camera' },
        { value: 'Hệ thống chuông', label: 'Hệ thống chuông' },
        { value: 'Email Support', label: 'Email Support' }
      );
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('❌ Error fetching ticket categories:', error);

    // Return fallback categories on error
    res.json({
      success: true,
      data: [
        { value: 'Tổng quát', label: 'Tổng quát' },
        { value: 'Phần mềm', label: 'Phần mềm' },
        { value: 'Hệ thống mạng', label: 'Hệ thống mạng' },
        { value: 'Hệ thống camera', label: 'Hệ thống camera' },
        { value: 'Hệ thống chuông', label: 'Hệ thống chuông' },
        { value: 'Email Support', label: 'Email Support' }
      ]
    });
  }
};

/**
 * Debug team members (for admin)
 */
const debugTeamMembers = async (req, res) => {
  try {
    const members = await SupportTeamMember.getAllMembers();

    const result = members.map(member => ({
      _id: member._id,
      email: member.email,
      fullname: member.fullname,
      roles: member.roles,
      active: member.active,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt
    }));

    res.json({
      success: true,
      members: result,
      count: result.length
    });

  } catch (error) {
    console.error('❌ Error debugging team members:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy thông tin debug đội ngũ'
    });
  }
};

/**
 * Escalate ticket (for urgent cases)
 */
const escalateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullname || req.user.email;

    const Ticket = require("../../models/Ticket");
    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: only creator or assigned user can escalate
    const isCreator = ticket.creator.equals(userId);
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);

    if (!isCreator && !isAssignedTo) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền escalate ticket này'
      });
    }

    // Check if ticket can be escalated
    if (ticket.priority === 'High') {
      return res.status(400).json({
        success: false,
        message: 'Ticket đã được đánh dấu ưu tiên cao'
      });
    }

    // Update priority and add escalation note
    ticket.priority = 'High';
    ticket.notes = (ticket.notes || '') + `\n\n[ESCALATED] ${new Date().toISOString()}: ${reason || 'Yêu cầu xử lý khẩn cấp'}`;

    // Log escalation
    const { TICKET_LOGS } = require('../../utils/logFormatter');
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.ESCALATED(userName, reason || 'Yêu cầu xử lý khẩn cấp'),
      user: userId
    });

    await ticket.save();

    // Try to send notification
    try {
      const notificationService = require('../../services/notificationService');
      await notificationService.sendTicketEscalated(ticket);
    } catch (notificationError) {
      console.error('❌ Notification error:', notificationError);
    }

    res.json({
      success: true,
      message: 'Ticket đã được escalate thành công',
      ticket: ticket
    });

  } catch (error) {
    console.error('❌ Error escalating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể escalate ticket'
    });
  }
};

module.exports = {
  getMe,
  getSupportTeam,
  addUserToSupportTeam,
  removeUserFromSupportTeam,
  getTicketCategories,
  debugTeamMembers,
  escalateTicket
};
