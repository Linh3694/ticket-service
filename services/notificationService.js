const redisClient = require('../config/redis');

class NotificationService {
  constructor() {
    this.channel = 'ticket_notifications';
  }

  // Gửi thông báo ticket mới
  async sendNewTicketNotification(ticket) {
    const notification = {
      type: 'new_ticket',
      ticketId: ticket._id,
      ticketCode: ticket.ticketCode,
      title: ticket.title,
      creator: ticket.creator,
      assignedTo: ticket.assignedTo,
      priority: ticket.priority,
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent new ticket notification:', ticket.ticketCode);
  }

  // Gửi thông báo cập nhật ticket
  async sendTicketUpdateNotification(ticket, action = 'updated') {
    const notification = {
      type: 'ticket_update',
      action: action,
      ticketId: ticket._id,
      ticketCode: ticket.ticketCode,
      title: ticket.title,
      status: ticket.status,
      creator: ticket.creator,
      assignedTo: ticket.assignedTo,
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent ticket update notification:', ticket.ticketCode);
  }

  // Gửi thông báo feedback
  async sendFeedbackNotification(ticket) {
    const notification = {
      type: 'ticket_feedback',
      ticketId: ticket._id,
      ticketCode: ticket.ticketCode,
      title: ticket.title,
      feedback: ticket.feedback,
      assignedTo: ticket.assignedTo,
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent feedback notification:', ticket.ticketCode);
  }

  // Gửi thông báo message mới
  async sendNewMessageNotification(ticket, message) {
    const notification = {
      type: 'new_message',
      ticketId: ticket._id,
      ticketCode: ticket.ticketCode,
      messageId: message._id,
      sender: message.sender,
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('📢 [Ticket Service] Sent new message notification:', ticket.ticketCode);
  }

  // Gửi thông báo SLA breach
  async sendSLABreachNotification(ticket) {
    const notification = {
      type: 'sla_breach',
      ticketId: ticket._id,
      ticketCode: ticket.ticketCode,
      title: ticket.title,
      sla: ticket.sla,
      escalateLevel: ticket.escalateLevel,
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('⚠️ [Ticket Service] Sent SLA breach notification:', ticket.ticketCode);
  }

  // Gửi thông báo agent status
  async sendAgentStatusNotification(agentId, status) {
    const notification = {
      type: 'agent_status',
      agentId: agentId,
      status: status,
      timestamp: new Date().toISOString()
    };

    await redisClient.publish(this.channel, notification);
    console.log('👤 [Ticket Service] Sent agent status notification:', agentId, status);
  }
}

module.exports = new NotificationService(); 