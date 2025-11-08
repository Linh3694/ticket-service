const Ticket = require("../../models/Ticket");
const SupportTeam = require("../../models/SupportTeam");
const SupportTeamMember = require("../../models/SupportTeamMember");
const notificationService = require('../../services/notificationService');
const emailController = require('../emailController');
const { TICKET_LOGS, SUBTASK_LOGS, OTHER_LOGS, normalizeVietnameseName, translateStatus } = require('../../utils/logFormatter');
const mongoose = require("mongoose");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Import User model for getTechnicalUsers
const User = require("../../models/Users");

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';

// Helper function to build full file URL after FRAPPE_API_URL constant
function buildFullFileUrl(relativePath) {
  return `${FRAPPE_API_URL}${relativePath}`;
}

/**
 * Get technical users for ticket assignment
 * Returns users with technical/IT roles
 */
async function getTechnicalUsers(token = null) {
  try {
    // For email tickets, prioritize users with "Email Ticket" role
    // Query với filter roles (sẽ auto-populate user data)
    const emailTicketMembers = await SupportTeamMember.getAllMembers({ roles: 'Email Ticket' });

    if (emailTicketMembers.length > 0) {
      // Sort by ticket count (least assigned first)
      const sortedMembers = await Promise.all(
        emailTicketMembers.map(async (member) => {
          const ticketCount = await Ticket.countDocuments({ assignedTo: member._id });
          return { ...member, ticketCount };
        })
      );

      sortedMembers.sort((a, b) => a.ticketCount - b.ticketCount);

      return sortedMembers.map(member => ({
        _id: member._id,
        email: member.email,
        fullname: member.fullname, // Already populated from Users
        name: member.fullname,
        disabled: false // Members are always active
      }));
    }

    // Fallback: get from SupportTeamMember collection (other technical roles)
    const allMembers = await SupportTeamMember.getAllMembers();
    const supportMembers = allMembers.filter(m =>
      m.roles && m.roles.some(r => ['Overall', 'Software', 'Network System', 'Camera System', 'Bell System'].includes(r))
    );

    if (supportMembers.length > 0) {
      // Sort by ticket count (least assigned first)
      const sortedMembers = await Promise.all(
        supportMembers.map(async (member) => {
          const ticketCount = await Ticket.countDocuments({ assignedTo: member._id });
          return { ...member, ticketCount };
        })
      );

      sortedMembers.sort((a, b) => a.ticketCount - b.ticketCount);

      return sortedMembers.map(member => ({
        _id: member._id,
        email: member.email,
        fullname: member.fullname, // Already populated from Users
        name: member.fullname,
        disabled: false // Members are always active
      }));
    }

    // Final fallback: get users with technical roles from User collection
    const technicalUsers = await User.find({
      active: true,
      disabled: { $ne: true },
      $or: [
        { role: { $in: ['technical', 'superadmin'] } },
        { roles: { $in: ['SIS IT', 'IT Helpdesk', 'System Manager'] } }
      ]
    }).lean();

    return technicalUsers.map(user => ({
      _id: user._id,
      email: user.email,
      fullname: user.fullname,
      name: user.fullname,
      disabled: user.disabled
    }));

  } catch (error) {
    console.error('❌ Error getting technical users:', error);
    return [];
  }
}

/**
 * Create new ticket
 */
const createTicket = async (req, res) => {
  try {
    console.log('🎫 [createTicket] Starting ticket creation...');
    console.log('   Body:', JSON.stringify(req.body, null, 2));

    const { title, description, category, notes } = req.body;
    const userId = req.user._id;

    // Validation
    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: 'Tiêu đề không được để trống' });
    }
    if (!description?.trim()) {
      return res.status(400).json({ success: false, message: 'Mô tả chi tiết không được để trống' });
    }
    if (!category) {
      return res.status(400).json({ success: false, message: 'Hạng mục không được để trống' });
    }

    // Import helper functions
    const { generateTicketCode, assignTicketToUser, logTicketHistory } = require('../../utils/ticketHelper');

    // 1️⃣ Generate ticket code
    const ticketCode = await generateTicketCode(category);
    console.log(`   Generated code: ${ticketCode}`);

    // 2️⃣ Auto-assign to team member with matching role
    const assignedToId = await assignTicketToUser(category);
    console.log(`   Assigned to: ${assignedToId || 'None'}`);

    // 3️⃣ Create ticket
    console.log(`🔧 [createTicket] Creating ticket with:`);
    console.log(`   assignedToId: ${assignedToId}`);
    console.log(`   assignedToId type: ${typeof assignedToId}`);
    console.log(`   assignedToId || undefined: ${assignedToId || 'undefined'}`);

    const newTicket = new Ticket({
      ticketCode,
      title: title.trim(),
      description: description.trim(),
      category,
      creator: userId,
      assignedTo: assignedToId || undefined,
      priority: 'Medium', // Default priority
      status: 'Assigned',
      notes: notes?.trim() || '',
      attachments: req.files ? req.files.map(file => ({
        filename: file.originalname,
        url: file.path || file.filename
      })) : []
    });

    console.log(`🔧 [createTicket] After new Ticket():`);
    console.log(`   newTicket.assignedTo: ${newTicket.assignedTo}`);
    console.log(`   newTicket.assignedTo type: ${typeof newTicket.assignedTo}`);

    await newTicket.save();
    console.log(`✅ [createTicket] Ticket created: ${newTicket._id}`);

    // 3️⃣ Move uploaded files from temp folder to ticket folder if any
    if (req.files && req.files.length > 0) {
      const tempFolder = 'uploads/Tickets/temp';
      const ticketFolder = `uploads/Tickets/${newTicket.ticketCode}`;

      // Create ticket folder if it doesn't exist
      if (!fs.existsSync(ticketFolder)) {
        fs.mkdirSync(ticketFolder, { recursive: true });
      }

      console.log(`   📁 Moving files to: ${ticketFolder}`);

      // Move each file from temp to ticket folder
      for (const file of req.files) {
        const oldPath = file.path;
        const newPath = path.join(ticketFolder, file.filename);

        try {
          fs.renameSync(oldPath, newPath);
          console.log(`   📁 Moved: ${file.filename}`);

          // Update attachment URL in database
          const attachmentIndex = newTicket.attachments.findIndex(a => a.url.includes(file.filename));
          if (attachmentIndex !== -1) {
            newTicket.attachments[attachmentIndex].url = buildFullFileUrl(`/${newPath}`);
          }
        } catch (moveError) {
          console.error(`   ⚠️  Error moving file ${file.filename}:`, moveError.message);
        }
      }

      // Save updated ticket with new file paths
      await newTicket.save();
      console.log(`   ✅ All files moved successfully`);
    }

    console.log(`🔧 [createTicket] After save():`);
    console.log(`   newTicket.assignedTo: ${newTicket.assignedTo}`);

    // 4️⃣ Log history
    const creatorName = req.user.fullname || req.user.email;
    console.log(`📝 [createTicket] Creator name: "${creatorName}"`);

    // Log ticket creation
    await logTicketHistory(newTicket._id, TICKET_LOGS.CREATED(creatorName), userId);

    // Log assignment if assigned
    if (assignedToId) {
      const assignedUser = await User.findById(assignedToId);
      if (assignedUser) {
        const assignedName = assignedUser.fullname || assignedUser.email;
        await logTicketHistory(newTicket._id, TICKET_LOGS.ASSIGNED(assignedName, creatorName), userId);
      }
    }

    // 5️⃣ Send notifications
    try {
      if (assignedToId) {
        await notificationService.sendTicketAssigned(newTicket, assignedToId);
      }
    } catch (notificationError) {
      console.error('❌ Notification error:', notificationError);
      // Don't fail the request if notification fails
    }

    // Populate for response
    await newTicket.populate('creator assignedTo', 'fullname email avatarUrl jobTitle');

    res.status(201).json({
      success: true,
      data: newTicket,
      message: 'Ticket đã được tạo thành công'
    });

  } catch (error) {
    console.error('❌ [createTicket] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tạo ticket',
      error: error.message
    });
  }
};

/**
 * Get tickets with filtering
 */
const getTickets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      category,
      priority,
      assignedTo,
      creator,
      search
    } = req.query;

    const filter = {};

    // Add filters
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (creator) filter.creator = creator;

    // Search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { ticketCode: { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: [
        { path: 'creator', select: 'fullname email avatarUrl' },
        { path: 'assignedTo', select: 'fullname email avatarUrl jobTitle' }
      ]
    };

    const result = await Ticket.paginate(filter, options);

    res.json({
      success: true,
      data: {
        tickets: result.docs,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.totalDocs,
          pages: result.totalPages
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy danh sách ticket'
    });
  }
};

/**
 * Get all tickets (for admin/support team) - without pagination
 */
const getAllTickets = async (req, res) => {
  try {
    const { status, category, assignedTo, creator, search } = req.query;

    const filter = {};

    // Add filters
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (creator) filter.creator = creator;

    // Search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { ticketCode: { $regex: search, $options: 'i' } }
      ];
    }

    const tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .populate([
        { path: 'creator', select: 'fullname email avatarUrl' },
        { path: 'assignedTo', select: 'fullname email avatarUrl jobTitle' }
      ])
      .lean();

    res.json({
      success: true,
      data: {
        tickets
      }
    });

  } catch (error) {
    console.error('❌ Error fetching all tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy danh sách ticket'
    });
  }
};

/**
 * Get user's tickets
 */
const getMyTickets = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, category, page = 1, limit = 10 } = req.query;

    const filter = { creator: userId };

    if (status) filter.status = status;
    if (category) filter.category = category;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: [
        { path: 'creator', select: 'fullname email avatarUrl' },
        { path: 'assignedTo', select: 'fullname email avatarUrl jobTitle' }
      ]
    };

    const result = await Ticket.paginate(filter, options);

    res.json({
      success: true,
      data: {
        tickets: result.docs,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.totalDocs,
          pages: result.totalPages
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching my tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy danh sách ticket của bạn'
    });
  }
};

/**
 * Get ticket by ID
 */
const getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findById(ticketId)
      .populate('creator', 'fullname email avatarUrl jobTitle department')
      .populate('assignedTo', 'fullname email avatarUrl jobTitle department')
      .populate('history.user', 'fullname email avatarUrl');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    res.json({
      success: true,
      data: ticket
    });

  } catch (error) {
    console.error('❌ Error fetching ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy thông tin ticket'
    });
  }
};

/**
 * Update ticket
 */
const updateTicket = async (req, res) => {
  const { ticketId } = req.params;
  const updates = req.body;
  const userId = req.user._id;

  try {
    console.log('📝 [updateTicket] Updating ticket:', ticketId);
    console.log('   Updates:', JSON.stringify(updates, null, 2));

    // Handle file attachments if provided
    if (req.files && req.files.length > 0) {
      console.log(`   Files: ${req.files.length} file(s)`);
      updates.attachments = req.files.map(file => ({
        filename: file.originalname,
        url: file.path || file.filename
      }));
    }

    const ticket = await Ticket.findById(ticketId)
      .populate('creator assignedTo');

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Check permission: only creator or assignedTo can update
    if (!ticket.creator.equals(userId) && (!ticket.assignedTo || !ticket.assignedTo.equals(userId)) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: "Bạn không có quyền chỉnh sửa ticket này" });
    }

    const previousStatus = ticket.status;

    // 📝 Log status change
    if (updates.status && updates.status !== ticket.status) {
      const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
      ticket.history.push({
        timestamp: new Date(),
        action: TICKET_LOGS.STATUS_CHANGED(previousStatus, updates.status, userName),
        user: userId
      });

      // Set acceptedAt khi status chuyển sang "Processing"
      if (updates.status === "Processing" && !ticket.acceptedAt) {
        ticket.acceptedAt = new Date();
      }

      // Set closedAt khi status chuyển sang "Closed" hoặc "Done"
      if ((updates.status === "Closed" || updates.status === "Done") && !ticket.closedAt) {
        ticket.closedAt = new Date();
      }
    }

    // 📝 Log other field changes
    if (updates.title && updates.title !== ticket.title) {
      const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
      ticket.history.push({
        timestamp: new Date(),
        action: OTHER_LOGS.FIELD_UPDATED('tiêu đề', userName),
        user: userId
      });
    }

    if (updates.description && updates.description !== ticket.description) {
      const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
      ticket.history.push({
        timestamp: new Date(),
        action: OTHER_LOGS.FIELD_UPDATED('mô tả', userName),
        user: userId
      });
    }

    // Update fields
    Object.assign(ticket, updates);
    ticket.updatedAt = new Date();

    await ticket.save();
    console.log(`✅ [updateTicket] Ticket updated: ${ticketId}`);

    // Populate for response
    await ticket.populate('creator assignedTo', 'fullname email avatarUrl');

    res.status(200).json({
      success: true,
      data: {
        _id: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        status: ticket.status,
        priority: ticket.priority,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo,
        notes: ticket.notes,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        acceptedAt: ticket.acceptedAt,
        closedAt: ticket.closedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể cập nhật ticket',
      error: error.message
    });
  }
};

/**
 * Delete ticket
 */
const deleteTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: only creator can delete
    if (!ticket.creator.equals(userId) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa ticket này'
      });
    }

    await Ticket.findByIdAndDelete(ticketId);

    res.json({
      success: true,
      message: 'Ticket đã được xóa thành công'
    });

  } catch (error) {
    console.error('❌ Error deleting ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể xóa ticket'
    });
  }
};

/**
 * Assign ticket to current user
 */
const assignTicketToMe = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check if ticket is already assigned
    if (ticket.assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'Ticket đã được gán cho người khác'
      });
    }

    // Update ticket
    ticket.assignedTo = userId;
    ticket.status = 'Processing';
    ticket.acceptedAt = new Date();

    // Log assignment
    const userName = req.user.fullname || req.user.email;
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.ASSIGNED(userName, userName),
      user: userId
    });

    await ticket.save();

    // Populate for response
    await ticket.populate('creator assignedTo', 'fullname email avatarUrl');

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket đã được gán cho bạn'
    });

  } catch (error) {
    console.error('❌ Error assigning ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể gán ticket'
    });
  }
};

/**
 * Cancel ticket with reason
 */
const cancelTicketWithReason = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { cancelReason } = req.body;
    const userId = req.user._id;

    if (!cancelReason?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp lý do hủy'
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission
    if (!ticket.creator.equals(userId) && (!ticket.assignedTo || !ticket.assignedTo.equals(userId))) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền hủy ticket này'
      });
    }

    ticket.status = 'Cancelled';
    ticket.cancellationReason = cancelReason.trim();

    // Log cancellation
    const userName = req.user.fullname || req.user.email;
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.CANCELLED(userName, cancelReason.trim()),
      user: userId
    });

    await ticket.save();

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket đã được hủy'
    });

  } catch (error) {
    console.error('❌ Error cancelling ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể hủy ticket'
    });
  }
};

/**
 * Reopen ticket
 */
const reopenTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: only creator can reopen
    if (!ticket.creator.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ người tạo mới có thể mở lại ticket'
      });
    }

    // Check if ticket can be reopened
    if (ticket.status !== 'Done' && ticket.status !== 'Closed') {
      return res.status(400).json({
        success: false,
        message: 'Ticket không thể được mở lại'
      });
    }

    ticket.status = 'Processing';
    ticket.closedAt = null;

    // Log reopening
    const userName = req.user.fullname || req.user.email;
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.REOPENED(userName),
      user: userId
    });

    await ticket.save();

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket đã được mở lại'
    });

  } catch (error) {
    console.error('❌ Error reopening ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể mở lại ticket'
    });
  }
};

module.exports = {
  getTechnicalUsers,
  createTicket,
  getTickets,
  getAllTickets,
  getMyTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  assignTicketToMe,
  cancelTicketWithReason,
  reopenTicket
};
