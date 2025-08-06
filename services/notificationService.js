const redisClient = require('../config/redis');

class NotificationService {
  constructor() {
    this.channel = 'ticket-service';
  }

  // Gửi thông báo ticket mới
  async sendNewTicketNotification(ticket) {
    const notification = {
      service: 'ticket-service',
      event: 'ticket_created',
      data: {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo,
        priority: ticket.priority
      },
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent new ticket notification:', ticket.ticketCode);
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
}

module.exports = new NotificationService(); 