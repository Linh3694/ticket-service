const Ticket = require("../../models/Ticket");
const notificationService = require('../../services/notificationService');
const { TICKET_LOGS } = require('../../utils/logFormatter');
const { logMessageSent, logTicketStatusChanged } = require('../../utils/logger');
const { Types, connection } = require('mongoose');

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

    console.log(`📋 [sendMessage] Ticket: ${ticket.ticketCode}, status: ${ticket.status}, waitingForCustomerEmailSent: ${ticket.waitingForCustomerEmailSent}, creator: ${ticket.creator?.email}`);

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
    // Priority: Support action takes precedence when user is both creator and assignedTo
    if (isAssignedTo && ticket.status === 'Processing') {
      // Support replied, change to Waiting for Customer
      ticket.status = 'Waiting for Customer';
      statusChanged = true;
      newStatus = 'Waiting for Customer';
    } else if (isCreator && ticket.status === 'Waiting for Customer' && !isAssignedTo) {
      // Customer replied, change to Processing (only if not also assignedTo)
      ticket.status = 'Processing';
      statusChanged = true;
      newStatus = 'Processing';
    } else if (isCreator && (ticket.status === 'Done' || ticket.status === 'Closed') && !isAssignedTo) {
      // Customer reopened ticket from Done/Closed status
      ticket.status = 'Processing';
      ticket.closedAt = null; // Reset closed timestamp
      statusChanged = true;
      newStatus = 'Processing';
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

          // For "Waiting for Customer" status from "Processing", include message content if available (only once per ticket)
          if (newStatus === 'Waiting for Customer' && oldStatus === 'Processing') {
            // Check if email has already been sent for Processing -> Waiting for Customer transition
            if (ticket.waitingForCustomerEmailSent) {
              console.log(`📧 [sendMessage] Email already sent for Processing->Waiting for Customer transition on ticket ${ticket.ticketCode}, skipping...`);
            } else {
              let messageContent = null;
              let messageSender = null;

              if (text && text.trim()) {
                messageContent = text.trim();
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
          } else if (newStatus === 'Waiting for Customer') {
            // For Waiting for Customer from other statuses (not Processing), send email without message content
            console.log(`📧 [sendMessage] Sending email for ${oldStatus}->Waiting for Customer transition (without message content)`);
            const { sendStatusChangeEmail } = require('./ticketOperations');
            sendStatusChangeEmail(ticket, oldStatus, newStatus, req.user).catch(error => {
              console.error(`❌ [sendMessage] Failed to send status change email via helper:`, error.message);
            });
          } else if (oldStatus === 'Done' || oldStatus === 'Closed') {
            // Customer reopened ticket - always send email
            console.log(`📧 [sendMessage] Customer reopened ticket from ${oldStatus} to ${newStatus}, sending email`);
            const { sendStatusChangeEmail } = require('./ticketOperations');
            sendStatusChangeEmail(ticket, oldStatus, newStatus, req.user).catch(error => {
              console.error(`❌ [sendMessage] Failed to send status change email via helper:`, error.message);
            });
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

    // 📱 Send push notifications
    // 1. If creator sent message, notify assignee
    if (isCreator && ticket.assignedTo) {
      try {
        await notificationService.sendUserReplyNotification(
          ticket,
          req.user
        );
      } catch (notificationError) {
        console.error('❌ User reply notification failed:', notificationError.message);
      }
    }

    // 2. If status changed, send status change notification
    if (statusChanged) {
      try {
        await notificationService.sendTicketStatusChangeNotification(
          ticket,
          oldStatus,
          newStatus,
          req.user._id
        );
      } catch (notificationError) {
        console.error('❌ Status change notification failed:', notificationError.message);
      }
    }

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
