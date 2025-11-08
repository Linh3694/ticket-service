const Ticket = require("../../models/Ticket");
const { TICKET_LOGS } = require('../../utils/logFormatter');
const { Types } = require('mongoose');

/**
 * Send message to ticket
 */
const sendMessage = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { text } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullname || req.user.email;

    // Check if there's text or files
    const hasText = text?.trim();
    const hasFiles = req.files && (Array.isArray(req.files) ? req.files.length > 0 : Object.keys(req.files).length > 0);

    if (!hasText && !hasFiles) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung tin nhắn hoặc ảnh không được để trống'
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: creator, assignedTo, or support team
    const isCreator = ticket.creator.equals(userId);
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );

    if (!isCreator && !isAssignedTo && !isSupportTeam) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền gửi tin nhắn cho ticket này'
      });
    }

    // Check if ticket status allows messaging
    if (!['Processing', 'Waiting for Customer'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Không thể gửi tin nhắn khi ticket ở trạng thái hiện tại'
      });
    }

    let statusChanged = false;
    let oldStatus = ticket.status;
    let newStatus = ticket.status;

    // Auto-change status based on sender
    if (isCreator && ticket.status === 'Waiting for Customer') {
      // Customer replied, change to Processing
      ticket.status = 'Processing';
      statusChanged = true;
      newStatus = 'Processing';
    } else if (isAssignedTo && ticket.status === 'Processing') {
      // Support replied, change to Waiting for Customer
      ticket.status = 'Waiting for Customer';
      statusChanged = true;
      newStatus = 'Waiting for Customer';
    }

    // Process file uploads (multer stores files in uploads/Tickets)
    const images = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        // Multer already saved the file, just reference it
        // file.path is relative to project root after multer saves it
        const relativePath = file.path.replace(/\\/g, '/'); // normalize path separators
        console.log(`✅ File uploaded: ${file.originalname} -> ${relativePath}`);
        // Store path for frontend to access via /uploads/Tickets/...
        images.push(relativePath);
      }
    }

    // Create message object
    const message = {
      _id: new Types.ObjectId(),
      sender: {
        _id: userId,
        fullname: userName,
        email: req.user.email,
        avatarUrl: req.user.avatarUrl
      },
      text: hasText ? text.trim() : '',
      timestamp: new Date(),
      type: images.length > 0 ? (hasText ? 'text_with_images' : 'image') : 'text',
      images: images.length > 0 ? images : undefined
    };

    // Add message to ticket
    if (!ticket.messages) {
      ticket.messages = [];
    }
    ticket.messages.push(message);

    // Log message in history
    const messagePreview = text.length > 50 ? text.substring(0, 50) + '...' : text;
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.MESSAGE_SENT(userName, messagePreview),
      user: userId
    });

    // Log status change if any
    if (statusChanged) {
      ticket.history.push({
        timestamp: new Date(),
        action: TICKET_LOGS.STATUS_CHANGED(oldStatus, newStatus, userName),
        user: userId
      });
    }

    ticket.updatedAt = new Date();
    await ticket.save();

    res.json({
      success: true,
      message: 'Tin nhắn đã được gửi thành công',
      messageData: message,
      ticket: {
        _id: ticket._id,
        status: ticket.status,
        updatedAt: ticket.updatedAt
      },
      statusChanged,
      oldStatus: statusChanged ? oldStatus : undefined,
      newStatus: statusChanged ? newStatus : undefined
    });

  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể gửi tin nhắn',
      error: error.message
    });
  }
};

/**
 * Get ticket messages
 */
const getTicketMessages = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId)
      .populate('messages.sender', 'fullname email avatarUrl');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission
    const isCreator = ticket.creator.equals(userId);
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );

    if (!isCreator && !isAssignedTo && !isSupportTeam) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xem tin nhắn của ticket này'
      });
    }

    const messages = ticket.messages || [];

    res.json({
      success: true,
      messages: messages
    });

  } catch (error) {
    console.error('❌ Error fetching ticket messages:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tải tin nhắn'
    });
  }
};

/**
 * Get ticket history
 */
const getTicketHistory = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId)
      .populate('history.user', 'fullname email avatarUrl');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission
    const isCreator = ticket.creator.equals(userId);
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );

    if (!isCreator && !isAssignedTo && !isSupportTeam) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xem lịch sử của ticket này'
      });
    }

    const history = ticket.history || [];

    res.json({
      success: true,
      data: history
    });

  } catch (error) {
    console.error('❌ Error fetching ticket history:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tải lịch sử ticket'
    });
  }
};

module.exports = {
  sendMessage,
  getTicketMessages,
  getTicketHistory
};
