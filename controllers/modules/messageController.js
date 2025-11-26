const Ticket = require("../../models/Ticket");
const { TICKET_LOGS } = require('../../utils/logFormatter');
const { logMessageSent, logTicketStatusChanged } = require('../../utils/logger');
const { Types, connection } = require('mongoose');

/**
 * Send message to ticket
 */
const sendMessage = async (req, res) => {
  try {
    console.log(`🚀 [sendMessage] START - ticketId: ${req.params.ticketId}, user: ${req.user.email}`);
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

    const ticket = await Ticket.findById(ticketId)
      .populate('creator', 'fullname email avatarUrl jobTitle department')
      .populate('assignedTo', 'fullname email avatarUrl jobTitle department');

    if (!ticket) {
      console.log(`❌ [sendMessage] Ticket not found: ${ticketId}`);
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    console.log(`📋 [sendMessage] Found ticket: ${ticket.ticketCode}, status: ${ticket.status}, waitingForCustomerEmailSent: ${ticket.waitingForCustomerEmailSent}`);
    console.log(`👤 [sendMessage] Creator: ${ticket.creator?.fullname} (${ticket.creator?.email})`);
    console.log(`👨‍💼 [sendMessage] AssignedTo: ${ticket.assignedTo?.fullname} (${ticket.assignedTo?.email})`);

    // Check permission: creator, assignedTo, or support team
    const isCreator = ticket.creator.equals(userId);
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );

    console.log(`🔍 [sendMessage] Permission check: isCreator=${isCreator}, isAssignedTo=${isAssignedTo}, isSupportTeam=${isSupportTeam}`);
    console.log(`🔍 [sendMessage] User: ${req.user.email} (${userId}), Ticket assignedTo: ${ticket.assignedTo}`);

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
    // Priority: Support action takes precedence when user is both creator and assignedTo
    console.log(`🔄 [sendMessage] Status change logic: isAssignedTo=${isAssignedTo}, isCreator=${isCreator}, currentStatus=${ticket.status}`);
    if (isAssignedTo && ticket.status === 'Processing') {
      // Support replied, change to Waiting for Customer
      console.log(`🔄 [sendMessage] Support replied - changing status from Processing to Waiting for Customer`);
      ticket.status = 'Waiting for Customer';
      statusChanged = true;
      newStatus = 'Waiting for Customer';
    } else if (isCreator && ticket.status === 'Waiting for Customer' && !isAssignedTo) {
      // Customer replied, change to Processing (only if not also assignedTo)
      console.log(`🔄 [sendMessage] Customer replied - changing status from Waiting for Customer to Processing`);
      ticket.status = 'Processing';
      statusChanged = true;
      newStatus = 'Processing';
    } else {
      console.log(`🔄 [sendMessage] No status change needed`);
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

    // Log message sent
    try {
      const userEmail = req.user.email || 'unknown';
      const userName = req.user.fullname || req.user.email || 'unknown';
      logMessageSent(userEmail, userName, ticketId, (text || '').length, images.length > 0);
    } catch (logErr) {
      console.warn('⚠️  Failed to log message sent:', logErr.message);
    }

    // Log status change if any
    if (statusChanged) {
      try {
        const userEmail = req.user.email || 'unknown';
        const userName = req.user.fullname || req.user.email || 'unknown';
        logTicketStatusChanged(userEmail, userName, ticketId, oldStatus, newStatus);
      } catch (logErr) {
        console.warn('⚠️  Failed to log status change:', logErr.message);
      }

      // Send email notification to customer when support team changes status
      console.log(`📧 [sendMessage] Debug: isAssignedTo=${isAssignedTo}, creatorEmail=${ticket.creator?.email}, ticketCode=${ticket.ticketCode}, statusChanged=${statusChanged}, newStatus=${newStatus}`);
      if (isAssignedTo && ticket.creator?.email) {
        try {
          const emailServiceUrl = process.env.EMAIL_SERVICE_URL || 'http://localhost:5030';
          console.log(`📧 [sendMessage] ENTERING EMAIL LOGIC - emailServiceUrl=${emailServiceUrl}, recipient=${ticket.creator.email}`);

          // For "Waiting for Customer" status, include message content if available
          if (newStatus === 'Waiting for Customer') {
            // Check if email has already been sent for this status (only send once per ticket)
            if (ticket.waitingForCustomerEmailSent) {
              console.log(`📧 [sendMessage] Email already sent for "Waiting for Customer" status on ticket ${ticket.ticketCode}, skipping...`);
            } else {
              let messageContent = null;
              let messageSender = null;

              if (message && message.trim()) {
                messageContent = message.trim();
                messageSender = req.user.fullname || req.user.email || 'Kỹ thuật viên';
                console.log(`📧 [sendMessage] Including message content in email: "${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}"`);
              }

              // Call email service with message content
              const axios = require('axios');
              axios.post(`${emailServiceUrl}/notify-ticket-status`, {
                ticketId: ticket._id.toString(),
                recipientEmail: ticket.creator.email,
                messageContent: messageContent,
                messageSender: messageSender
              }, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
              }).then(async (response) => {
                console.log(`✅ [sendMessage] Status change email with message sent to customer:`, response.data);

                // Mark email as sent for this status
                try {
                  await Ticket.findByIdAndUpdate(ticket._id, { waitingForCustomerEmailSent: true });
                  console.log(`✅ [sendMessage] Marked waitingForCustomerEmailSent=true for ticket ${ticket.ticketCode}`);
                } catch (updateError) {
                  console.error(`❌ [sendMessage] Failed to update waitingForCustomerEmailSent flag:`, updateError.message);
                }
              }).catch(error => {
                console.error(`❌ [sendMessage] Failed to send status change email:`, error.message);
              });
            }
          } else {
            // For other status changes, use the helper function
            const { sendStatusChangeEmail } = require('./ticketOperations');
            sendStatusChangeEmail(ticket, oldStatus, newStatus, req.user).catch(error => {
              console.error(`❌ [sendMessage] Failed to send status change email via helper:`, error.message);
            });
          }
        } catch (emailErr) {
          console.warn('⚠️ [sendMessage] Failed to initiate status change email:', emailErr.message);
        }
      }
    }

    // Broadcast new message to WebSocket clients (EXCEPT sender)
    // Sender already has optimistic message and receives via onSuccess
    try {
      const wsHandler = req.app.get('wsHandler');
      if (wsHandler) {
        // Broadcast to all clients EXCEPT the sender
        // This prevents duplicate messages at sender's UI
        wsHandler.broadcastToTicketExcept(ticketId, userId, {
          type: 'new_message',
          message: message,
          timestamp: new Date().toISOString()
        });
        console.log(`📡 [WebSocket] Broadcasted message to ticket: ${ticketId} (except sender: ${userId})`);
      }

      // Also broadcast ticket update if status changed (to all including sender)
      if (statusChanged && wsHandler) {
        wsHandler.broadcastToTicket(ticketId, {
          type: 'ticket_updated',
          ticket: {
            _id: ticket._id,
            status: ticket.status,
            updatedAt: ticket.updatedAt
          },
          timestamp: new Date().toISOString()
        });
        console.log(`📡 [WebSocket] Broadcasted ticket status update to: ${ticketId}`);
      }
    } catch (wsError) {
      console.warn('⚠️ [WebSocket] Failed to broadcast message:', wsError.message);
    }

    console.log(`✅ [sendMessage] END - Success, statusChanged=${statusChanged}, newStatus=${newStatus}`);
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
    console.error('❌ [sendMessage] Error:', error);
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
