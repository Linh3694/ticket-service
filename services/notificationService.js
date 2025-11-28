const redisClient = require('../config/redis');
const axios = require('axios');
const { Expo } = require('expo-server-sdk');
const User = require('../models/Users');
require('dotenv').config({ path: './config.env' });

// Khởi tạo instance của Expo
let expo = new Expo();

class NotificationService {
  constructor() {
    this.notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5004';
    this.apiKey = process.env.NOTIFICATION_SERVICE_API_KEY;
    this.enabled = process.env.ENABLE_NOTIFICATION_INTEGRATION === 'true';
    this.channel = process.env.REDIS_NOTIFICATION_CHANNEL || 'notification_events';
    
    // Axios instance để gọi notification-service API
    this.api = axios.create({
      baseURL: this.notificationServiceUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    this.setupInterceptors();
  }

  /**
   * Gửi push notifications đến các thiết bị
   * @param {Array} pushTokens - Danh sách token thiết bị
   * @param {String} title - Tiêu đề thông báo
   * @param {String} body - Nội dung thông báo
   * @param {Object} data - Dữ liệu bổ sung
   */
  async sendPushNotifications(pushTokens, title, body, data = {}) {
    try {
      console.log(`📱 [Notification] Sending push notifications to ${pushTokens.length} devices`);

      // Tạo danh sách messages để gửi
      let messages = [];

      // Kiểm tra và lọc các token hợp lệ
      for (let pushToken of pushTokens) {
        if (!Expo.isExpoPushToken(pushToken)) {
          console.error(`❌ [Notification] Push token ${pushToken} không phải là token Expo hợp lệ`);
          continue;
        }

        // Thêm thông báo vào danh sách
        messages.push({
          to: pushToken,
          sound: 'default',
          title,
          body,
          data,
        });
      }

      if (messages.length === 0) {
        console.log('⚠️  [Notification] No valid push tokens found');
        return [];
      }

      // Chia thành chunks để tránh vượt quá giới hạn của Expo
      let chunks = expo.chunkPushNotifications(messages);
      let tickets = [];

      // Gửi từng chunk
      for (let chunk of chunks) {
        try {
          let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
          console.log(`✅ [Notification] Sent chunk of ${chunk.length} notifications`);
        } catch (error) {
          console.error('❌ [Notification] Lỗi khi gửi chunk:', error);
        }
      }

      return tickets;
    } catch (error) {
      console.error('❌ [Notification] Lỗi trong quá trình gửi push notifications:', error);
      return [];
    }
  }

  /**
   * Lấy push tokens của user
   * @param {String} userId - ID của user
   * @returns {Array} Danh sách push tokens
   */
  async getUserPushTokens(userId) {
    try {
      const user = await User.findById(userId).select('deviceToken');
      return user && user.deviceToken ? [user.deviceToken] : [];
    } catch (error) {
      console.error(`❌ [Notification] Error getting push tokens for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Gửi thông báo cho user với cả push notification và service notification
   * @param {String} userId - ID của user
   * @param {String} title - Tiêu đề
   * @param {String} body - Nội dung
   * @param {Object} data - Dữ liệu bổ sung
   * @param {String} type - Loại thông báo
   */
  async sendNotificationToUser(userId, title, body, data = {}, type = 'system') {
    try {
      console.log(`📢 [Notification] Sending notification to user ${userId}: ${title}`);

      let pushNotificationSent = false;
      let serviceNotificationSent = false;

      // 1. Gửi push notification trực tiếp qua Expo (nếu có token)
      const pushTokens = await this.getUserPushTokens(userId);
      if (pushTokens.length > 0) {
        try {
          await this.sendPushNotifications(pushTokens, title, body, data);
          pushNotificationSent = true;
          console.log(`✅ [Notification] Sent push notification to user ${userId} with ${pushTokens.length} tokens`);
        } catch (pushError) {
          console.error(`❌ [Notification] Push notification failed for user ${userId}:`, pushError.message);
        }
      } else {
        console.log(`ℹ️ [Notification] No push tokens found for user ${userId} (this is normal for web-only users)`);
      }

      // 2. Gửi qua notification service (nếu có và khả dụng)
      if (this.enabled) {
        try {
          const notificationData = {
            type,
            title,
            body,
            recipients: [userId],
            data,
            priority: this.getPriorityLevel(data.priority || 'medium'),
            sound: 'default',
            badge: 1
          };

          await this.api.post('/api/notifications/send', notificationData);
          serviceNotificationSent = true;
          console.log(`✅ [Notification] Sent service notification to user ${userId}`);
        } catch (serviceError) {
          console.warn(`⚠️  [Notification] External notification service failed (${serviceError.response?.status || serviceError.code}), notification may not reach user:`, serviceError.message);
        }
      } else {
        console.log(`ℹ️ [Notification] External notification service disabled`);
      }

      // 3. Luôn publish to Redis for real-time updates (web app, etc.)
      await this.publishNotificationEvent('notification_sent', {
        userId,
        title,
        body,
        data,
        type,
        pushNotificationSent,
        serviceNotificationSent,
        timestamp: new Date()
      });
      console.log(`✅ [Notification] Published real-time notification event for user ${userId}`);

      // Summary
      const channels = [];
      if (pushNotificationSent) channels.push('push');
      if (serviceNotificationSent) channels.push('service');
      channels.push('realtime');

      console.log(`📊 [Notification] Notification sent to user ${userId} via: ${channels.join(', ')}`);

    } catch (error) {
      console.error(`❌ [Notification] Error sending notification to user ${userId}:`, error);
      throw error;
    }
  }

  setupInterceptors() {
    this.api.interceptors.request.use(
      (config) => {
        if (this.apiKey) {
          config.headers['X-API-Key'] = this.apiKey;
        }
        
        console.log(`📢 [Ticket Service] -> Notification Service: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ [Ticket Service] Notification API request error:', error.message);
        return Promise.reject(error);
      }
    );

    this.api.interceptors.response.use(
      (response) => {
        console.log(`✅ [Ticket Service] Notification Service response: ${response.status}`);
        return response;
      },
      (error) => {
        console.error(`❌ [Ticket Service] Notification Service error:`, {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  // Gửi thông báo ticket mới
  async sendNewTicketNotification(ticket) {
    try {
      console.log(`📢 [Ticket Service] Sending new ticket notification for ${ticket.ticketCode}`);

      const recipients = await this.getTicketNotificationRecipients(ticket);

      if (recipients.length === 0) {
        console.log(`⚠️ [Ticket Service] No recipients for new ticket notification`);
        return;
      }

      const title = '🎫 Ticket mới';
      const body = `Ticket mới #${ticket.ticketNumber || ticket.ticketCode}: ${ticket.title}`;

      // Gửi trực tiếp push notifications cho từng recipient
      for (const userId of recipients) {
        try {
          await this.sendNotificationToUser(userId, title, body, {
            ticketId: ticket._id.toString(),
            ticketCode: ticket.ticketCode || ticket.ticketNumber,
            action: 'new_ticket_admin',
            category: ticket.category,
            priority: ticket.priority,
            timestamp: new Date().toISOString()
          }, 'new_ticket_admin');
        } catch (error) {
          console.error(`❌ [Ticket Service] Failed to send new ticket notification to user ${userId}:`, error.message);
        }
      }

      console.log(`✅ [Ticket Service] Sent new ticket notification to ${recipients.length} recipients`);

      // Fallback: gửi qua Redis
      await this.publishNotificationEvent('ticket_created', {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo,
        priority: ticket.priority
      });

    } catch (error) {
      console.error('❌ [Ticket Service] Error sending new ticket notification:', error.message);
      throw error;
    }
  }

  // Gửi thông báo cập nhật ticket
  async sendTicketUpdateNotification(ticket, action = 'updated', excludeUserId = null) {
    const eventMap = {
      'updated': 'ticket_updated',
      'status_updated': 'ticket_status_changed',
      'assigned': 'ticket_assigned',
      'feedback_added': 'ticket_feedback',
      'comment_added': 'message_sent'
    };

    const notification = {
      service: 'ticket-service',
      event: eventMap[action] || 'ticket_updated',
      data: {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        status: ticket.status,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo,
        action: action,
        excludeUserId: excludeUserId
      },
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent ticket update notification:', ticket.ticketCode, action);
  }

  // Gửi thông báo feedback
  async sendFeedbackNotification(ticket) {
    const notification = {
      service: 'ticket-service',
      event: 'ticket_feedback',
      data: {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        feedback: ticket.feedback,
        assignedTo: ticket.assignedTo
      },
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent feedback notification:', ticket.ticketCode);
  }

  // Gửi thông báo message mới
  async sendNewMessageNotification(ticket, message) {
    const notification = {
      service: 'ticket-service',
      event: 'message_sent',
      data: {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        messageId: message._id,
        sender: message.sender
      },
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent new message notification:', ticket.ticketCode);
  }

  // Gửi thông báo SLA breach
  async sendSLABreachNotification(ticket) {
    const notification = {
      service: 'ticket-service',
      event: 'sla_breach',
      data: {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        sla: ticket.sla,
        escalateLevel: ticket.escalateLevel
      },
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('⚠️ [Ticket Service] Sent SLA breach notification:', ticket.ticketCode);
  }

  // Gửi thông báo agent status
  async sendAgentStatusNotification(agentId, status) {
    const notification = {
      service: 'ticket-service',
      event: 'agent_status',
      data: {
        agentId: agentId,
        status: status
      },
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('👤 [Ticket Service] Sent agent status notification:', agentId, status);
  }

  // =========================
  // TICKET STATE CHANGE NOTIFICATIONS
  // =========================

  // Mapping trạng thái ticket với thông báo
  getTicketStatusNotificationConfig(status) {
    const statusConfigs = {
      'Assigned': {
        title: '🎫 Ticket đã được gán',
        body: 'Ticket #{ticketCode} đã được gán cho bạn: {title}',
        priority: 'high',
        action: 'ticket_assigned'
      },
      'Processing': {
        title: '⚡ Ticket đang xử lý',
        body: 'Ticket #{ticketCode} đang được xử lý: {title}',
        priority: 'normal',
        action: 'ticket_processing'
      },
      'Waiting for Customer': {
        title: '⏳ Chờ phản hồi khách hàng',
        body: 'Ticket #{ticketCode} đang chờ phản hồi của bạn: {title}',
        priority: 'normal',
        action: 'ticket_waiting'
      },
      'Done': {
        title: '✅ Ticket đã hoàn thành',
        body: 'Ticket #{ticketCode} đã được giải quyết: {title}',
        priority: 'normal',
        action: 'ticket_done'
      },
      'Closed': {
        title: '🔒 Ticket đã đóng',
        body: 'Ticket #{ticketCode} đã được đóng: {title}',
        priority: 'low',
        action: 'ticket_closed'
      },
      'Cancelled': {
        title: '❌ Ticket đã hủy',
        body: 'Ticket #{ticketCode} đã bị hủy: {title}',
        priority: 'low',
        action: 'ticket_cancelled'
      }
    };

    return statusConfigs[status] || null;
  }

  // Gửi thông báo khi trạng thái ticket thay đổi
  async sendTicketStatusChangeNotification(ticket, oldStatus, newStatus, changedBy = null) {
    try {
      console.log(`📢 [Ticket Service] Processing status change event: ${oldStatus} → ${newStatus}`);

      const statusConfig = this.getTicketStatusNotificationConfig(newStatus);
      if (!statusConfig) {
        console.log(`⚠️ [Ticket Service] No notification config for status: ${newStatus}`);
        return;
      }

      // Lấy danh sách người nhận
      const recipients = await this.getTicketNotificationRecipients(ticket, newStatus);

      // Loại bỏ người thực hiện hành động khỏi danh sách nhận notification
      const filteredRecipients = changedBy
        ? recipients.filter(userId => userId.toString() !== changedBy.toString())
        : recipients;

      if (filteredRecipients.length === 0) {
        console.log(`⚠️ [Ticket Service] No recipients for ticket status notification`);
        return;
      }

      console.log(`📢 [Ticket Service] Sending event to Frappe for ${filteredRecipients.length} recipients`);

      // Gửi event về Frappe để Frappe handle notifications
      await this.sendEventToFrappe('ticket_status_changed', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        oldStatus: oldStatus,
        newStatus: newStatus,
        changedBy: changedBy,
        recipients: filteredRecipients,
        priority: statusConfig.priority,
        category: ticket.category,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo,
        notification: {
          title: statusConfig.title,
          body: statusConfig.body.replace('{ticketCode}', ticket.ticketCode || ticket.ticketNumber || 'Unknown').replace('{title}', ticket.title || 'No title'),
          action: statusConfig.action,
          data: {
            ticketId: ticket._id.toString(),
            ticketCode: ticket.ticketCode || ticket.ticketNumber,
            action: statusConfig.action,
            oldStatus: oldStatus,
            newStatus: newStatus,
            priority: statusConfig.priority
          }
        }
      });

      // Vẫn publish real-time event cho ticket-service internal use
      await this.publishNotificationEvent('ticket_status_changed', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        oldStatus: oldStatus,
        newStatus: newStatus,
        changedBy: changedBy,
        recipients: filteredRecipients,
        priority: statusConfig.priority
      });

      console.log(`✅ [Ticket Service] Ticket status change event sent to Frappe for ${ticket.ticketCode}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending ticket status change event:', error);
      throw error;
    }
  }

  // Gửi thông báo khi ticket được assign
  async sendTicketAssignmentNotification(ticket, assignedTo, assignedBy) {
    try {
      console.log(`👤 [Ticket Service] Sending assignment notification for ticket ${ticket.ticketCode}`);

      const title = '👤 Ticket được gán';
      const body = `Ticket #${ticket.ticketCode || ticket.ticketNumber} đã được gán cho bạn: ${ticket.title || 'No title'}`;

      await this.sendNotificationToUser(assignedTo._id || assignedTo, title, body, {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        action: 'ticket_assigned',
        assignedBy: assignedBy._id || assignedBy,
        priority: 'high',
        timestamp: new Date().toISOString()
      }, 'ticket_assignment');

      // Publish real-time event
      await this.publishNotificationEvent('ticket_assigned', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        assignedTo: assignedTo._id || assignedTo,
        assignedBy: assignedBy._id || assignedBy
      });

      console.log(`✅ [Ticket Service] Sent assignment notification for ${ticket.ticketCode}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending ticket assignment notification:', error);
      throw error;
    }
  }

  // =========================
  // ADMIN/SUPPORT TEAM NOTIFICATIONS
  // =========================

  // Gửi thông báo ticket mới cho support team
  async sendNewTicketToSupportTeamNotification(ticket) {
    try {
      console.log(`🆕 [Ticket Service] Processing new ticket event for support team: ${ticket.ticketCode}`);

      // Lấy tất cả support team members
      const supportTeamRecipients = await this.getSupportTeamRecipients(ticket.category);

      if (supportTeamRecipients.length === 0) {
        console.log(`⚠️ [Ticket Service] No support team members found for category: ${ticket.category}`);
        return;
      }

      console.log(`🆕 [Ticket Service] Sending event to Frappe for ${supportTeamRecipients.length} support team members`);

      // Gửi event về Frappe để Frappe handle notifications
      await this.sendEventToFrappe('new_ticket_created', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo,
        recipients: supportTeamRecipients,
        notification: {
          title: '🎫 Ticket mới',
          body: `Ticket mới #${ticket.ticketCode || ticket.ticketNumber}: ${ticket.title || 'No title'} (${ticket.category})`,
          action: 'new_ticket_admin',
          data: {
            ticketId: ticket._id.toString(),
            ticketCode: ticket.ticketCode || ticket.ticketNumber,
            action: 'new_ticket_admin',
            category: ticket.category,
            priority: ticket.priority
          }
        }
      });

      // Vẫn publish real-time event cho ticket-service internal use
      await this.publishNotificationEvent('ticket_created', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        supportTeamRecipients: supportTeamRecipients
      });

      console.log(`✅ [Ticket Service] New ticket event sent to Frappe for ${ticket.ticketCode}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending new ticket event:', error);
      throw error;
    }
  }

  // Gửi thông báo khi người dùng phản hồi ticket
  async sendUserReplyNotification(ticket, messageSender) {
    try {
      console.log(`💬 [Ticket Service] Processing user reply event for ticket ${ticket.ticketCode}`);

      // Lấy danh sách người nhận (chỉ assignee hiện tại)
      const recipients = await this.getTicketNotificationRecipients(ticket, ticket.status);

      if (recipients.length === 0) {
        console.log(`⚠️ [Ticket Service] No recipients for user reply notification`);
        return;
      }

      console.log(`💬 [Ticket Service] Sending event to Frappe for ${recipients.length} recipients`);

      // Gửi event về Frappe để Frappe handle notifications
      await this.sendEventToFrappe('user_reply', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        assignedTo: ticket.assignedTo,
        messageSender: messageSender._id || messageSender,
        recipients: recipients,
        notification: {
          title: '💬 Người dùng đã phản hồi',
          body: `Ticket #${ticket.ticketCode || ticket.ticketNumber} có phản hồi mới: ${ticket.title || 'No title'}`,
          action: 'user_reply',
          data: {
            ticketId: ticket._id.toString(),
            ticketCode: ticket.ticketCode || ticket.ticketNumber,
            action: 'user_reply',
            messageSender: messageSender._id || messageSender,
            priority: 'high'
          }
        }
      });

      // Vẫn publish real-time event cho ticket-service internal use
      await this.publishNotificationEvent('user_reply', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        assignedTo: ticket.assignedTo,
        messageSender: messageSender._id || messageSender
      });

      console.log(`✅ [Ticket Service] User reply event sent to Frappe for ${ticket.ticketCode}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending user reply event:', error);
      throw error;
    }
  }

  // Gửi thông báo khi ticket bị cancel
  async sendTicketCancelledNotification(ticket, cancelledBy) {
    try {
      console.log(`❌ [Ticket Service] Processing ticket cancelled event for ${ticket.ticketCode}`);

      // Lấy danh sách người nhận
      const recipients = await this.getTicketNotificationRecipients(ticket, 'Cancelled');

      if (recipients.length === 0) {
        console.log(`⚠️ [Ticket Service] No recipients for cancelled ticket ${ticket.ticketCode}`);
        return;
      }

      console.log(`❌ [Ticket Service] Sending event to Frappe for ${recipients.length} recipients`);

      // Gửi event về Frappe để Frappe handle notifications
      await this.sendEventToFrappe('ticket_cancelled', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        cancelledBy: cancelledBy._id || cancelledBy,
        cancellationReason: ticket.cancellationReason,
        recipients: recipients,
        notification: {
          title: '❌ Ticket đã bị hủy',
          body: `Ticket #${ticket.ticketCode || ticket.ticketNumber} đã bị hủy: ${ticket.title || 'No title'}`,
          action: 'ticket_cancelled_admin',
          data: {
            ticketId: ticket._id.toString(),
            ticketCode: ticket.ticketCode || ticket.ticketNumber,
            action: 'ticket_cancelled_admin',
            cancelledBy: cancelledBy._id || cancelledBy,
            cancellationReason: ticket.cancellationReason,
            priority: 'high'
          }
        }
      });

      // Vẫn publish real-time event cho ticket-service internal use
      await this.publishNotificationEvent('ticket_cancelled_admin', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        cancelledBy: cancelledBy._id || cancelledBy,
        cancellationReason: ticket.cancellationReason,
        recipients: recipients
      });

      console.log(`✅ [Ticket Service] Ticket cancelled event sent to Frappe for ${ticket.ticketCode}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending ticket cancelled event:', error);
      throw error;
    }
  }

  // Gửi thông báo khi ticket được xác nhận hoàn thành bởi người dùng
  async sendTicketCompletionConfirmationNotification(ticket, confirmedBy) {
    try {
      console.log(`✅ [Ticket Service] Processing completion confirmation event for ${ticket.ticketCode}`);

      // Lấy danh sách người nhận
      const recipients = await this.getTicketNotificationRecipients(ticket, 'Done');

      if (recipients.length === 0) {
        console.log(`⚠️ [Ticket Service] No recipients for completion confirmation notification`);
        return;
      }

      console.log(`✅ [Ticket Service] Sending event to Frappe for ${recipients.length} recipients`);

      // Gửi event về Frappe để Frappe handle notifications
      await this.sendEventToFrappe('completion_confirmed', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        assignedTo: ticket.assignedTo,
        confirmedBy: confirmedBy._id || confirmedBy,
        recipients: recipients,
        notification: {
          title: '✅ Ticket đã được xác nhận hoàn thành',
          body: `Ticket #${ticket.ticketCode || ticket.ticketNumber} đã được xác nhận hoàn thành: ${ticket.title || 'No title'}`,
          action: 'completion_confirmed',
          data: {
            ticketId: ticket._id.toString(),
            ticketCode: ticket.ticketCode || ticket.ticketNumber,
            action: 'completion_confirmed',
            confirmedBy: confirmedBy._id || confirmedBy,
            priority: 'normal'
          }
        }
      });

      // Vẫn publish real-time event cho ticket-service internal use
      await this.publishNotificationEvent('completion_confirmed', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        assignedTo: ticket.assignedTo,
        confirmedBy: confirmedBy._id || confirmedBy
      });

      console.log(`✅ [Ticket Service] Completion confirmation event sent to Frappe for ${ticket.ticketCode}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending completion confirmation event:', error);
      throw error;
    }
  }

  // Gửi thông báo khi ticket được feedback với số sao
  async sendTicketFeedbackNotification(ticket, feedbackData) {
    try {
      console.log(`⭐ [Ticket Service] Processing feedback event for ${ticket.ticketCode}`);

      // Lấy danh sách người nhận
      const recipients = await this.getTicketNotificationRecipients(ticket, 'Closed');

      if (recipients.length === 0) {
        console.log(`⚠️ [Ticket Service] No recipients for feedback notification`);
        return;
      }

      console.log(`⭐ [Ticket Service] Sending event to Frappe for ${recipients.length} recipients`);

      // Gửi event về Frappe để Frappe handle notifications
      await this.sendEventToFrappe('ticket_feedback_received', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        assignedTo: ticket.assignedTo,
        rating: feedbackData.rating,
        feedbackComment: feedbackData.comment,
        recipients: recipients,
        notification: {
          title: '⭐ Ticket nhận được đánh giá',
          body: `Ticket #${ticket.ticketCode || ticket.ticketNumber} nhận được ${feedbackData.rating} sao: ${ticket.title || 'No title'}`,
          action: 'ticket_feedback_received',
          data: {
            ticketId: ticket._id.toString(),
            ticketCode: ticket.ticketCode || ticket.ticketNumber,
            action: 'ticket_feedback_received',
            rating: feedbackData.rating,
            feedbackComment: feedbackData.comment,
            priority: 'normal'
          }
        }
      });

      // Vẫn publish real-time event cho ticket-service internal use
      await this.publishNotificationEvent('ticket_feedback_received', {
        ticketId: ticket._id.toString(),
        ticketCode: ticket.ticketCode || ticket.ticketNumber,
        title: ticket.title,
        assignedTo: ticket.assignedTo,
        rating: feedbackData.rating,
        feedbackComment: feedbackData.comment
      });

      console.log(`✅ [Ticket Service] Feedback event sent to Frappe for ${ticket.ticketCode}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending feedback event:', error);
      throw error;
    }
  }

  // Helper: Lấy danh sách support team members cho một category
  async getSupportTeamRecipients(category) {
    try {
      // Import models dynamically to avoid circular dependencies
      const SupportTeamMember = require('../models/SupportTeamMember');

      // Tìm support team members có role phù hợp với category
      const categoryRoleMap = {
        'Software': ['Software', 'Overall'],
        'Camera': ['Camera', 'Overall'],
        'Network': ['Network System', 'Overall'],
        'Bell System': ['Bell System', 'Overall'],
        'Account': ['Account', 'Overall'],
        'Email Ticket': ['Email Ticket', 'Overall'],
        'Overall': ['Overall']
      };

      const roles = categoryRoleMap[category] || ['Overall'];

      const supportMembers = await SupportTeamMember.find({
        isActive: true,
        roles: { $in: roles }
      }).populate('userId', 'email').lean();

      const emails = supportMembers
        .map(member => member.userId?.email)
        .filter(email => email != null);

      return [...new Set(emails)]; // Remove duplicates
    } catch (error) {
      console.error('❌ [Ticket Service] Error getting support team recipients:', error);
      return [];
    }
  }

  // Helper methods
  async getTicketNotificationRecipients(ticket, status = null) {
    const recipients = new Set();

    // Thêm assignee hiện tại (lấy email từ database)
    if (ticket.assignedTo) {
      const assigneeEmail = await this.getUserEmailById(ticket.assignedTo._id || ticket.assignedTo);
      if (assigneeEmail) {
        recipients.add(assigneeEmail);
        console.log(`📢 [Recipients] Added assignee: ${assigneeEmail}`);
      }
    }

    // Thêm support team members (lấy email từ database)
    if (ticket.supportTeam && Array.isArray(ticket.supportTeam)) {
      for (const member of ticket.supportTeam) {
        const memberId = member._id || member.userId || member;
        if (memberId) {
          const memberEmail = await this.getUserEmailById(memberId);
          if (memberEmail) {
            recipients.add(memberEmail);
            console.log(`📢 [Recipients] Added support team member: ${memberEmail}`);
          }
        }
      }
    }

    // Thêm watchers/followers (lấy email từ database)
    if (ticket.followers && Array.isArray(ticket.followers)) {
      for (const follower of ticket.followers) {
        const followerId = follower._id || follower.userId || follower;
        if (followerId) {
          const followerEmail = await this.getUserEmailById(followerId);
          if (followerEmail) {
            recipients.add(followerEmail);
            console.log(`📢 [Recipients] Added follower: ${followerEmail}`);
          }
        }
      }
    }

    // Status-specific recipient logic
    const creator = ticket.createdBy || ticket.creator;
    const creatorId = creator?._id || creator;

    if (status) {
      switch (status) {
        case 'Done':
        case 'Closed':
          // Gửi cho creator khi ticket hoàn thành/đóng
          if (creatorId) {
            const creatorEmail = await this.getUserEmailById(creatorId);
            if (creatorEmail) {
              recipients.add(creatorEmail);
              console.log(`📢 [Recipients] Added creator for completion: ${creatorEmail}`);
            }
          }
          break;

        case 'Waiting for Customer':
          // Gửi cho creator khi cần phản hồi
          if (creatorId) {
            const creatorEmail = await this.getUserEmailById(creatorId);
            if (creatorEmail) {
              recipients.add(creatorEmail);
              console.log(`📢 [Recipients] Added creator for waiting: ${creatorEmail}`);
            }
          }
          break;

        case 'Cancelled':
          // Gửi cho creator khi ticket bị hủy
          if (creatorId) {
            const creatorEmail = await this.getUserEmailById(creatorId);
            if (creatorEmail) {
              recipients.add(creatorEmail);
              console.log(`📢 [Recipients] Added creator for cancellation: ${creatorEmail}`);
            }
          }
          break;

        default:
          // Cho các status khác, không gửi cho creator trừ khi họ là assignee
          if (creatorId && !ticket.assignedTo) {
            // Nếu không có assignee, vẫn gửi cho creator
            const creatorEmail = await this.getUserEmailById(creatorId);
            if (creatorEmail) {
              recipients.add(creatorEmail);
              console.log(`📢 [Recipients] Added creator (no assignee): ${creatorEmail}`);
            }
          }
          break;
      }
    } else {
      // Không có status specified, gửi cho assignee hoặc creator
      if (!ticket.assignedTo && creatorId) {
        const creatorEmail = await this.getUserEmailById(creatorId);
        if (creatorEmail) {
          recipients.add(creatorEmail);
          console.log(`📢 [Recipients] Added creator (fallback): ${creatorEmail}`);
        }
      }
    }

    // Convert to array and filter out null/undefined values
    const finalRecipients = Array.from(recipients).filter(email => email != null);
    console.log(`📢 [Recipients] Final count for status "${status}": ${finalRecipients.length} recipients`);

    return finalRecipients;
  }

  // Helper: Get user email by ID
  async getUserEmailById(userId) {
    try {
      if (!userId) return null;

      const User = require('../models/Users');
      const user = await User.findById(userId).select('email').lean();

      return user ? user.email : null;
    } catch (error) {
      console.error(`❌ [Notification] Error getting email for user ${userId}:`, error.message);
      return null;
    }
  }

  getPriorityLevel(priority) {
    const priorityMap = {
      'low': 'low',
      'normal': 'normal', 
      'high': 'high',
      'urgent': 'high',
      'critical': 'high'
    };
    return priorityMap[priority?.toLowerCase()] || 'normal';
  }

  // Publish notification event qua Redis
  async publishNotificationEvent(eventType, data) {
    try {
      const notification = {
        service: 'ticket-service',
        event: eventType,
        data: {
          ...data,
          timestamp: new Date().toISOString()
        }
      };

      await redisClient.publish(this.channel, notification);
      console.log(`📤 [Ticket Service] Published notification event: ${eventType}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error publishing notification event:', error.message);
    }
  }

  // =========================
  // TESTING METHODS
  // =========================

  // Test Redis pub/sub connection
  async testRedisConnection() {
    try {
      console.log('🔍 [Test] Testing Redis pub/sub connection...');

      // Test publish
      await redisClient.publish('test_channel', JSON.stringify({
        test: 'ticket-service-redis-connection',
        timestamp: new Date().toISOString()
      }));

      console.log('✅ [Test] Redis pub/sub test successful');
      return { success: true, message: 'Redis connection working' };
    } catch (error) {
      console.error('❌ [Test] Redis test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Test Frappe event sending
  async testFrappeEvent() {
    try {
      console.log('🔍 [Test] Testing Frappe event sending...');

      const testEvent = {
        ticketId: 'test123',
        ticketCode: 'TEST-001',
        oldStatus: 'Waiting for Customer',
        newStatus: 'Done',
        recipients: ['linh.nguyenhai@wellspring.edu.vn'],
        notification: {
          title: '✅ Test Ticket Completed',
          body: 'This is a test notification from ticket-service',
          action: 'test_notification'
        }
      };

      await this.sendEventToFrappe('test_ticket_event', testEvent);

      console.log('✅ [Test] Frappe event test successful');
      return { success: true, message: 'Event sent to Frappe successfully' };
    } catch (error) {
      console.error('❌ [Test] Frappe event test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // =========================
  // FRAPPE INTEGRATION
  // =========================

  // Gửi event về Frappe để trigger notifications
  async sendEventToFrappe(eventType, eventData) {
    try {
      console.log(`🔄 [Frappe Integration] Sending event to Frappe: ${eventType}`);

      const frappeEvent = {
        event_type: eventType,  // Changed from 'event' to 'event_type' to match Frappe endpoint
        event_data: {
          ...eventData,
          timestamp: new Date().toISOString(),
          source: 'ticket-service'
        }
      };

      // Import JWT helper
      const { getServiceAuthHeaders } = require('../utils/jwtHelper');

      // Get Frappe API URL from environment
      const frappeApiUrl = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';
      const ticketEndpoint = `${frappeApiUrl}/api/method/erp.api.notification.ticket.handle_ticket_event`;

      // Send via HTTP API call with JWT authentication
      const response = await this.api.post(ticketEndpoint, frappeEvent, {
        headers: getServiceAuthHeaders(),
        timeout: 30000
      });

      if (response.status === 200 && response.data?.success) {
        console.log(`✅ [Frappe Integration] Event sent successfully via HTTP API: ${eventType}`);
      } else {
        console.warn(`⚠️ [Frappe Integration] Unexpected response from Frappe:`, response.status, response.data);
      }

      console.log(`✅ [Frappe Integration] Event sent: ${eventType}`);
    } catch (error) {
      console.error('❌ [Frappe Integration] Error sending event to Frappe:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });

      // Fallback: try Redis if HTTP fails
      console.log('🔄 [Frappe Integration] Attempting fallback via Redis...');
      try {
        const fallbackEvent = {
          service: 'ticket-service',
          event: eventType,
          data: {
            ...eventData,
            timestamp: new Date().toISOString(),
            source: 'ticket-service'
          }
        };
        await redisClient.publish('frappe_notifications', JSON.stringify(fallbackEvent));
        console.log(`✅ [Frappe Integration] Event sent via Redis fallback: ${eventType}`);
      } catch (redisError) {
        console.error('❌ [Frappe Integration] Redis fallback also failed:', redisError.message);
      }
    }
  }

  // Gửi push notification trực tiếp
  async sendPushNotification(recipients, title, body, data = {}, options = {}) {
    try {
      if (!this.enabled || !recipients.length) {
        return false;
      }

      const notificationData = {
        type: options.type || 'general',
        title,
        body,
        recipients,
        data,
        priority: options.priority || 'normal',
        sound: options.sound || 'default',
        badge: options.badge || 1
      };

      const response = await this.api.post('/api/notifications/send', notificationData);
      return response.data && response.data.success;
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending push notification:', error.message);
      return false;
    }
  }

  // Lấy notification settings của user
  async getUserNotificationSettings(userId) {
    try {
      if (!this.enabled) {
        return this.getDefaultNotificationSettings();
      }

      const response = await this.api.get(`/api/notifications/settings/${userId}`);
      return response.data?.data || this.getDefaultNotificationSettings();
    } catch (error) {
      console.error('❌ [Ticket Service] Error getting notification settings:', error.message);
      return this.getDefaultNotificationSettings();
    }
  }

  getDefaultNotificationSettings() {
    return {
      newTickets: true,
      ticketUpdates: true,
      assignments: true,
      comments: true,
      statusChanges: true,
      priorityChanges: true,
      sounds: true,
      vibration: true
    };
  }

  // Kiểm tra kết nối đến notification service
  async healthCheck() {
    try {
      if (!this.enabled) {
        return {
          status: 'disabled',
          message: 'Notification integration is disabled',
          fallback: 'push_only',
          note: 'Using direct Expo push notifications only'
        };
      }

      const response = await this.api.get('/health');

      if (response.status === 200) {
        return {
          status: 'connected',
          message: 'Notification Service is reachable',
          url: this.notificationServiceUrl,
          fallback: 'none'
        };
      }

      return {
        status: 'error',
        message: `Unexpected response: ${response.status}`,
        url: this.notificationServiceUrl,
        fallback: 'push_only',
        note: 'Will fallback to direct Expo push notifications'
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        url: this.notificationServiceUrl,
        fallback: 'push_only',
        note: 'External service unavailable, using direct Expo push notifications'
      };
    }
  }
}

module.exports = new NotificationService(); 