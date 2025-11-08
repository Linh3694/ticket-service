const WebSocket = require('ws');
const { EventEmitter } = require('events');
const Ticket = require('../models/Ticket');
const Message = require('../models/Message');

class WebSocketHandler extends EventEmitter {
  constructor(server) {
    super();
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws',
      perMessageDeflate: false,
    });

    this.clients = new Map(); // Map of ticketId -> Set of WebSocket clients
    this.userConnections = new Map(); // Map of userId -> Set of WebSocket clients

    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const ticketId = this.extractTicketId(req.url);
      const userId = this.extractUserId(req.headers);

      if (!ticketId) {
        console.warn('❌ [WebSocket] No ticket ID provided');
        ws.close(1008, 'Ticket ID required');
        return;
      }

      console.log(`🔌 [WebSocket] Client connected - Ticket: ${ticketId}, User: ${userId}`);

      // Store client connection
      this.addClient(ticketId, ws);
      if (userId) {
        this.addUserConnection(userId, ws);
      }

      // Send initial connection confirmation
      ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        ticketId,
        timestamp: new Date().toISOString(),
      }));

      // Handle incoming messages
      ws.on('message', (data) => {
        this.handleMessage(ws, data, ticketId, userId);
      });

      // Handle ping/pong for keep-alive
      ws.on('ping', () => {
        ws.pong();
      });

      ws.on('pong', () => {
        // Keep-alive pong received
      });

      // Handle client disconnect
      ws.on('close', () => {
        console.log(`🔌 [WebSocket] Client disconnected - Ticket: ${ticketId}`);
        this.removeClient(ticketId, ws);
        if (userId) {
          this.removeUserConnection(userId, ws);
        }
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ [WebSocket] Error - Ticket: ${ticketId}:`, error.message);
      });

      // Send keep-alive ping every 30 seconds
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);
    });

    console.log('✅ [WebSocket] Server initialized on /ws');
  }

  handleMessage(ws, data, ticketId, userId) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'subscribe':
          console.log(`📡 [WebSocket] User ${userId} subscribed to ticket ${message.ticketId}`);
          this.addClient(message.ticketId, ws);
          break;

        case 'unsubscribe':
          console.log(`📡 [WebSocket] User ${userId} unsubscribed from ticket ${message.ticketId}`);
          this.removeClient(message.ticketId, ws);
          break;

        case 'new_message':
          // Broadcast new message to all clients in this ticket room
          this.broadcastToTicket(ticketId, {
            type: 'new_message',
            message: message.data,
            timestamp: new Date().toISOString(),
          });
          break;

        case 'ticket_update':
          // Broadcast ticket update to all clients in this ticket room
          this.broadcastToTicket(ticketId, {
            type: 'ticket_updated',
            ticket: message.data,
            timestamp: new Date().toISOString(),
          });
          break;

        default:
          console.warn(`⚠️ [WebSocket] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('❌ [WebSocket] Message parsing error:', error.message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
      }));
    }
  }

  // Add client to ticket room
  addClient(ticketId, ws) {
    if (!this.clients.has(ticketId)) {
      this.clients.set(ticketId, new Set());
    }
    this.clients.get(ticketId).add(ws);
  }

  // Remove client from ticket room
  removeClient(ticketId, ws) {
    if (this.clients.has(ticketId)) {
      this.clients.get(ticketId).delete(ws);
      if (this.clients.get(ticketId).size === 0) {
        this.clients.delete(ticketId);
      }
    }
  }

  // Add user connection
  addUserConnection(userId, ws) {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId).add(ws);
  }

  // Remove user connection
  removeUserConnection(userId, ws) {
    if (this.userConnections.has(userId)) {
      this.userConnections.get(userId).delete(ws);
      if (this.userConnections.get(userId).size === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  // Broadcast to all clients in a ticket room
  broadcastToTicket(ticketId, data) {
    const clients = this.clients.get(ticketId);
    if (clients) {
      const message = JSON.stringify(data);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  }

  // Broadcast to all clients of a user
  broadcastToUser(userId, data) {
    const connections = this.userConnections.get(userId);
    if (connections) {
      const message = JSON.stringify(data);
      connections.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  }

  // Broadcast to all connected clients
  broadcastAll(data) {
    const message = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Extract ticket ID from URL
  extractTicketId(url) {
    const params = new URLSearchParams(url.split('?')[1]);
    return params.get('ticket');
  }

  // Extract user ID from headers (from JWT token or custom header)
  extractUserId(headers) {
    // Try to extract from custom header first
    if (headers['x-user-id']) {
      return headers['x-user-id'];
    }

    // Try to extract from authorization header (Bearer token)
    if (headers.authorization) {
      const token = headers.authorization.replace('Bearer ', '');
      try {
        // Decode JWT (simple decode without verification)
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const decoded = JSON.parse(jsonPayload);
        return decoded.user_id || decoded.sub || decoded.id;
      } catch (error) {
        console.warn('⚠️ [WebSocket] Failed to decode authorization header');
      }
    }

    return null;
  }

  // Get connection count for a ticket
  getTicketConnectionCount(ticketId) {
    return this.clients.has(ticketId) ? this.clients.get(ticketId).size : 0;
  }

  // Get all connected tickets
  getConnectedTickets() {
    return Array.from(this.clients.keys());
  }
}

module.exports = WebSocketHandler;

