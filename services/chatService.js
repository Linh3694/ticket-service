const redisClient = require('../config/redis');
const axios = require('axios');

class ChatService {
  constructor() {
    this.chatServiceUrl = process.env.CHAT_SERVICE_URL || 'http://localhost:5002';
    this.channel = 'ticket_chat_events';
  }

  // Tạo group chat cho ticket
  async createTicketGroupChat(ticket, participants) {
    try {
      const chatData = {
        name: `Ticket: ${ticket.ticketCode}`,
        description: `Group chat cho ticket ${ticket.ticketCode}`,
        isGroup: true,
        creator: ticket.creator,
        participants: participants,
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode
      };

      // Gửi event qua Redis
      await redisClient.publish(this.channel, {
        type: 'create_group_chat',
        data: chatData
      });

      console.log('💬 [Ticket Service] Sent create group chat event for ticket:', ticket.ticketCode);
      return true;
    } catch (error) {
      console.error('❌ [Ticket Service] Error creating group chat:', error);
      return false;
    }
  }

  // Thêm user vào group chat
  async addUserToGroupChat(ticketId, userId) {
    try {
      await redisClient.publish(this.channel, {
        type: 'add_user_to_chat',
        data: {
          ticketId: ticketId,
          userId: userId
        }
      });

      console.log('➕ [Ticket Service] Sent add user to chat event:', userId);
      return true;
    } catch (error) {
      console.error('❌ [Ticket Service] Error adding user to chat:', error);
      return false;
    }
  }

  // Gửi message đến group chat
  async sendMessageToGroupChat(ticketId, message) {
    try {
      await redisClient.publish(this.channel, {
        type: 'send_message',
        data: {
          ticketId: ticketId,
          message: message
        }
      });

      console.log('💬 [Ticket Service] Sent message to group chat for ticket:', ticketId);
      return true;
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending message to chat:', error);
      return false;
    }
  }

  // Cập nhật ticket status trong chat
  async updateTicketStatusInChat(ticketId, status) {
    try {
      await redisClient.publish(this.channel, {
        type: 'update_ticket_status',
        data: {
          ticketId: ticketId,
          status: status
        }
      });

      console.log('🔄 [Ticket Service] Sent ticket status update to chat:', ticketId, status);
      return true;
    } catch (error) {
      console.error('❌ [Ticket Service] Error updating ticket status in chat:', error);
      return false;
    }
  }

  // Lấy thông tin group chat
  async getGroupChatInfo(ticketId) {
    try {
      const response = await axios.get(`${this.chatServiceUrl}/api/chats/ticket/${ticketId}`);
      return response.data;
    } catch (error) {
      console.error('❌ [Ticket Service] Error getting group chat info:', error);
      return null;
    }
  }

  // Subscribe để nhận events từ Chat service
  async subscribeToChatEvents() {
    try {
      await redisClient.subscribe('chat_ticket_events', (data) => {
        this.handleChatEvent(data);
      });
      console.log('👂 [Ticket Service] Subscribed to chat events');
    } catch (error) {
      console.error('❌ [Ticket Service] Error subscribing to chat events:', error);
    }
  }

  // Xử lý events từ Chat service
  handleChatEvent(data) {
    try {
      switch (data.type) {
        case 'chat_created':
          console.log('✅ [Ticket Service] Group chat created for ticket:', data.ticketId);
          break;
        case 'user_added':
          console.log('➕ [Ticket Service] User added to chat:', data.userId);
          break;
        case 'message_sent':
          console.log('💬 [Ticket Service] Message sent to chat:', data.messageId);
          break;
        default:
          console.log('📨 [Ticket Service] Received chat event:', data.type);
      }
    } catch (error) {
      console.error('❌ [Ticket Service] Error handling chat event:', error);
    }
  }
}

module.exports = new ChatService(); 