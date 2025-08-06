const redisClient = require('../config/redis');
const axios = require('axios');
require('dotenv').config({ path: './config.env' });

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