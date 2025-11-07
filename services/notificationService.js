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

      // 1. Gửi push notification
      const pushTokens = await this.getUserPushTokens(userId);
      if (pushTokens.length > 0) {
        await this.sendPushNotifications(pushTokens, title, body, data);
      }

      // 2. Gửi qua notification service (nếu có)
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
          console.log(`✅ [Notification] Sent service notification to user ${userId}`);
        } catch (serviceError) {
          console.warn(`⚠️  [Notification] Service notification failed, continuing with push only:`, serviceError.message);
        }
      }

      // 3. Publish to Redis for real-time updates
      await this.publishNotificationEvent('notification_sent', {
        userId,
        title,
        body,
        data,
        type,
        timestamp: new Date()
      });

    } catch (error) {
      console.error(`❌ [Notification] Error sending notification to user ${userId}:`, error);
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
      if (!this.enabled) {
        console.log('📢 [Ticket Service] Notification integration disabled');
        return;
      }

      const recipients = this.getTicketNotificationRecipients(ticket);
      
      const notificationData = {
        type: 'new_ticket',
        title: 'New Support Ticket',
        body: `New ticket #${ticket.ticketNumber || ticket.ticketCode}: ${ticket.title}`,
        recipients: recipients,
        data: {
          ticketId: ticket._id,
          ticketCode: ticket.ticketCode || ticket.ticketNumber,
          ticketTitle: ticket.title,
          priority: ticket.priority,
          status: ticket.status,
          creator: ticket.createdBy || ticket.creator
        },
        priority: this.getPriorityLevel(ticket.priority),
        sound: 'default',
        badge: 1
      };

      // Gọi trực tiếp API notification-service
      const response = await this.api.post('/api/notifications/send', notificationData);
      
      if (response.data && response.data.success) {
        console.log('📢 [Ticket Service] Sent new ticket notification:', ticket.ticketCode);
      }

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
      
      // Fallback: chỉ gửi qua Redis
      await this.publishNotificationEvent('ticket_created', {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        priority: ticket.priority
      });
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

  // Helper methods
  getTicketNotificationRecipients(ticket) {
    const recipients = new Set();
    
    // Thêm assignee
    if (ticket.assignedTo) {
      recipients.add(ticket.assignedTo);
    }
    
    // Thêm support team
    if (ticket.supportTeam && Array.isArray(ticket.supportTeam)) {
      ticket.supportTeam.forEach(member => {
        recipients.add(member._id || member);
      });
    }
    
    // Thêm watchers/followers
    if (ticket.followers && Array.isArray(ticket.followers)) {
      ticket.followers.forEach(follower => {
        recipients.add(follower._id || follower);
      });
    }
    
    // Không gửi cho người tạo ticket (trừ khi họ là assignee)
    const creator = ticket.createdBy || ticket.creator;
    if (creator && !ticket.assignedTo) {
      recipients.delete(creator);
    }
    
    return Array.from(recipients);
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
        return { status: 'disabled', message: 'Notification integration is disabled' };
      }

      const response = await this.api.get('/health');
      
      if (response.status === 200) {
        return { 
          status: 'connected', 
          message: 'Notification Service is reachable',
          url: this.notificationServiceUrl
        };
      }
      
      return { 
        status: 'error', 
        message: `Unexpected response: ${response.status}` 
      };
    } catch (error) {
      return { 
        status: 'error', 
        message: error.message,
        url: this.notificationServiceUrl 
      };
    }
  }
}

module.exports = new NotificationService(); 