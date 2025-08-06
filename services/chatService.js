const redisClient = require('../config/redis');
const axios = require('axios');
require('dotenv').config({ path: './config.env' });

class ChatService {
  constructor() {
    this.chatServiceUrl = process.env.CHAT_SERVICE_URL || 'http://localhost:5005';
    this.apiKey = process.env.CHAT_SERVICE_API_KEY;
    this.enabled = process.env.ENABLE_CHAT_INTEGRATION === 'true';
    this.channel = process.env.REDIS_TICKET_CHANNEL || 'ticket_events';
    
    // Axios instance để gọi chat-service API
    this.api = axios.create({
      baseURL: this.chatServiceUrl,
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
        
        console.log(`💬 [Ticket Service] -> Chat Service: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ [Ticket Service] Chat API request error:', error.message);
        return Promise.reject(error);
      }
    );

    this.api.interceptors.response.use(
      (response) => {
        console.log(`✅ [Ticket Service] Chat Service response: ${response.status}`);
        return response;
      },
      (error) => {
        console.error(`❌ [Ticket Service] Chat Service error:`, {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  // Tạo group chat cho ticket
  async createTicketGroupChat(ticket, participants) {
    try {
      if (!this.enabled) {
        console.log('💬 [Ticket Service] Chat integration disabled');
        return null;
      }

      const chatData = {
        name: `Ticket #${ticket.ticketNumber || ticket.ticketCode} - ${ticket.title}`,
        description: `Group chat for ticket: ${ticket.title}`,
        isGroup: true,
        creator: ticket.createdBy || ticket.creator,
        participants: this.getTicketParticipants(ticket, participants),
        settings: {
          allowMembersToAdd: false, // Chỉ admin/support team có thể thêm member
          allowMembersToEdit: false,
          muteNotifications: false
        },
        metadata: {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber || ticket.ticketCode,
          ticketStatus: ticket.status,
          ticketPriority: ticket.priority,
          department: ticket.department
        }
      };

      // Gọi trực tiếp API của chat-service
      const response = await this.api.post('/api/chat/group', chatData);
      
      if (response.data && response.data.success) {
        console.log('💬 [Ticket Service] Created group chat for ticket:', ticket.ticketCode);
        
        // Gửi webhook event
        await this.publishTicketEvent('ticket.group_chat_created', {
          ticketId: ticket._id,
          chatId: response.data.data._id,
          participants: chatData.participants
        });
        
        return response.data.data;
      }
      
      return null;
    } catch (error) {
      console.error('❌ [Ticket Service] Error creating group chat:', error.message);
      
      // Fallback: gửi event qua Redis
      try {
        await redisClient.publish(this.channel, {
          type: 'create_group_chat',
          service: 'ticket-service',
          data: {
            ticketId: ticket._id,
            ticketCode: ticket.ticketCode,
            chatData: {
              name: `Ticket #${ticket.ticketNumber || ticket.ticketCode}`,
              participants: this.getTicketParticipants(ticket, participants),
              metadata: { ticketId: ticket._id }
            }
          }
        });
      } catch (redisError) {
        console.error('❌ [Ticket Service] Redis fallback failed:', redisError.message);
      }
      
      return null;
    }
  }

  // Lấy danh sách participants cho ticket
  getTicketParticipants(ticket, additionalParticipants = []) {
    const participants = new Set();
    
    // Thêm người tạo ticket
    if (ticket.createdBy || ticket.creator) {
      participants.add(ticket.createdBy || ticket.creator);
    }
    
    // Thêm assignee
    if (ticket.assignedTo) {
      participants.add(ticket.assignedTo);
    }
    
    // Thêm support team members
    if (ticket.supportTeam && Array.isArray(ticket.supportTeam)) {
      ticket.supportTeam.forEach(member => {
        participants.add(member._id || member);
      });
    }
    
    // Thêm followers/watchers
    if (ticket.followers && Array.isArray(ticket.followers)) {
      ticket.followers.forEach(follower => {
        participants.add(follower._id || follower);
      });
    }

    // Thêm additional participants
    if (additionalParticipants && Array.isArray(additionalParticipants)) {
      additionalParticipants.forEach(participant => {
        participants.add(participant._id || participant);
      });
    }

    return Array.from(participants);
  }

  // Thêm user vào group chat
  async addUserToGroupChat(ticketId, userId, chatId = null) {
    try {
      if (!this.enabled) {
        return false;
      }

      // Nếu có chatId, gọi trực tiếp API
      if (chatId) {
        const response = await this.api.post(`/api/chat/${chatId}/add-user`, { userId });
        if (response.data && response.data.success) {
          console.log('➕ [Ticket Service] Added user to chat:', userId);
          return true;
        }
      }

      // Fallback: gửi event qua Redis
      await redisClient.publish(this.channel, {
        type: 'add_user_to_chat',
        service: 'ticket-service',
        data: {
          ticketId: ticketId,
          userId: userId
        }
      });

      console.log('➕ [Ticket Service] Sent add user to chat event:', userId);
      return true;
    } catch (error) {
      console.error('❌ [Ticket Service] Error adding user to chat:', error.message);
      return false;
    }
  }

  // Gửi message đến group chat
  async sendMessageToGroupChat(ticketId, message, chatId = null) {
    try {
      if (!this.enabled) {
        return false;
      }

      // Nếu có chatId, gọi trực tiếp API
      if (chatId) {
        const messageData = {
          content: message.content || message,
          messageType: message.messageType || 'text',
          sender: message.sender || 'system'
        };

        const response = await this.api.post(`/api/chat/${chatId}/messages`, messageData);
        if (response.data && response.data.success) {
          console.log('💬 [Ticket Service] Sent message to chat:', chatId);
          return true;
        }
      }

      // Fallback: gửi event qua Redis
      await redisClient.publish(this.channel, {
        type: 'send_message',
        service: 'ticket-service',
        data: {
          ticketId: ticketId,
          message: message
        }
      });

      console.log('💬 [Ticket Service] Sent message to group chat for ticket:', ticketId);
      return true;
    } catch (error) {
      console.error('❌ [Ticket Service] Error sending message to chat:', error.message);
      return false;
    }
  }

  // Cập nhật ticket status trong chat
  async updateTicketStatusInChat(ticketId, status, chatId = null) {
    try {
      if (!this.enabled) {
        return false;
      }

      // Gửi system message về status update
      const systemMessage = `Ticket status updated to: ${status}`;
      
      if (chatId) {
        await this.sendMessageToGroupChat(ticketId, {
          content: systemMessage,
          messageType: 'system',
          sender: 'system'
        }, chatId);
      }

      // Gửi event qua Redis
      await redisClient.publish(this.channel, {
        type: 'update_ticket_status',
        service: 'ticket-service',
        data: {
          ticketId: ticketId,
          status: status,
          timestamp: new Date().toISOString()
        }
      });

      console.log('🔄 [Ticket Service] Sent ticket status update to chat:', ticketId, status);
      return true;
    } catch (error) {
      console.error('❌ [Ticket Service] Error updating ticket status in chat:', error.message);
      return false;
    }
  }

  // Lấy thông tin group chat
  async getGroupChatInfo(ticketId) {
    try {
      if (!this.enabled) {
        return null;
      }

      const response = await this.api.get(`/api/chat/ticket/${ticketId}`);
      return response.data?.data || null;
    } catch (error) {
      console.error('❌ [Ticket Service] Error getting group chat info:', error.message);
      return null;
    }
  }

  // Tìm chat theo ticket ID
  async findChatByTicketId(ticketId) {
    try {
      if (!this.enabled) {
        return null;
      }

      const response = await this.api.get(`/api/chat/search?ticketId=${ticketId}`);
      return response.data?.data || null;
    } catch (error) {
      console.error('❌ [Ticket Service] Error finding chat by ticket ID:', error.message);
      return null;
    }
  }

  // Publish ticket event
  async publishTicketEvent(eventType, data) {
    try {
      await redisClient.publish(this.channel, {
        type: eventType,
        service: 'ticket-service',
        data: {
          ...data,
          timestamp: new Date().toISOString()
        }
      });
      
      console.log(`📤 [Ticket Service] Published event: ${eventType}`);
    } catch (error) {
      console.error('❌ [Ticket Service] Error publishing ticket event:', error.message);
    }
  }

  // Subscribe để nhận events từ Chat service
  async subscribeToChatEvents() {
    try {
      const chatChannel = process.env.REDIS_CHAT_CHANNEL || 'chat_events';
      
      await redisClient.subscribe(chatChannel, (message) => {
        this.handleChatEvent(JSON.parse(message));
      });
      
      console.log('👂 [Ticket Service] Subscribed to chat events');
    } catch (error) {
      console.error('❌ [Ticket Service] Error subscribing to chat events:', error.message);
    }
  }

  // Xử lý events từ Chat service
  handleChatEvent(data) {
    try {
      switch (data.type) {
        case 'chat_created':
          console.log('✅ [Ticket Service] Group chat created for ticket:', data.ticketId);
          this.onChatCreated(data);
          break;
          
        case 'user_added_to_chat':
          console.log('➕ [Ticket Service] User added to chat:', data.userId);
          this.onUserAddedToChat(data);
          break;
          
        case 'message_sent':
          console.log('💬 [Ticket Service] Message sent to chat:', data.messageId);
          this.onMessageSent(data);
          break;
          
        case 'ticket_status_updated':
          console.log('🔄 [Ticket Service] Ticket status updated in chat:', data.ticketId);
          break;
          
        default:
          console.log('📨 [Ticket Service] Received chat event:', data.type);
      }
    } catch (error) {
      console.error('❌ [Ticket Service] Error handling chat event:', error.message);
    }
  }

  // Event handlers
  async onChatCreated(data) {
    // Có thể cập nhật ticket record với chatId
    try {
      if (data.ticketId && data.chatId) {
        console.log(`💬 [Ticket Service] Chat ${data.chatId} created for ticket ${data.ticketId}`);
        // TODO: Cập nhật ticket record nếu cần
      }
    } catch (error) {
      console.error('❌ [Ticket Service] Error handling chat created event:', error.message);
    }
  }

  async onUserAddedToChat(data) {
    // Log hoặc thông báo khi có user mới được thêm
    console.log(`👤 [Ticket Service] User ${data.userId} added to chat for ticket ${data.ticketId}`);
  }

  async onMessageSent(data) {
    // Có thể trigger notification hoặc cập nhật ticket activity
    if (data.ticketId) {
      console.log(`💬 [Ticket Service] New message in ticket ${data.ticketId} chat`);
      // TODO: Có thể gọi notification service ở đây
    }
  }

  // Kiểm tra kết nối đến chat service
  async healthCheck() {
    try {
      if (!this.enabled) {
        return { status: 'disabled', message: 'Chat integration is disabled' };
      }

      const response = await this.api.get('/health');
      
      if (response.status === 200) {
        return { 
          status: 'connected', 
          message: 'Chat Service is reachable',
          url: this.chatServiceUrl
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
        url: this.chatServiceUrl 
      };
    }
  }
}

module.exports = new ChatService(); 