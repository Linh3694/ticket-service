const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.pubClient = null;
    this.subClient = null; // for socket.io adapter
    this.userSubClient = null; // dedicated subscriber for business channels
    this.secondarySubClient = null; // optional subscriber for Frappe's own Redis
  }

  async connect() {
    try {
      const url = process.env.REDIS_URL;
      const host = process.env.REDIS_HOST || '127.0.0.1';
      const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
      const password = process.env.REDIS_PASSWORD || undefined;

      const baseOpts = url
        ? { url }
        : {
            socket: {
              host,
              port,
            },
            password,
          };

      this.client = createClient(baseOpts);
      this.pubClient = createClient(baseOpts);
      this.subClient = this.pubClient.duplicate();
      this.userSubClient = createClient(baseOpts);

      // Basic diagnostics
      const target = url ? url : `${host}:${port}`;
      console.log(`[Ticket Service] Connecting to Redis at ${target}`);
      if (password) console.log('[Ticket Service] Redis password: set');

      this.client.on('error', (err) => console.error('[Ticket Service] Redis client error:', err.message));
      this.pubClient.on('error', (err) => console.error('[Ticket Service] Redis pub error:', err.message));
      this.subClient.on('error', (err) => console.error('[Ticket Service] Redis sub error:', err.message));
      this.userSubClient.on('error', (err) => console.error('[Ticket Service] Redis user-sub error:', err.message));

      this.client.on('ready', () => console.log('[Ticket Service] Redis client ready'));
      this.pubClient.on('ready', () => console.log('[Ticket Service] Redis pub ready'));
      this.subClient.on('ready', () => console.log('[Ticket Service] Redis sub ready'));
      this.userSubClient.on('ready', () => console.log('[Ticket Service] Redis user-sub ready'));

      await this.client.connect();
      await this.pubClient.connect();
      await this.subClient.connect();
      await this.userSubClient.connect();

      console.log('✅ [Ticket Service] Redis connected successfully');

      // Optional: connect secondary subscriber to Frappe's Redis (e.g., redis_socketio)
      const frappeUrl = process.env.FRAPPE_REDIS_URL || process.env.FRAPPE_REDIS_SOCKETIO;
      const frappeHost = process.env.FRAPPE_REDIS_HOST;
      const frappePort = process.env.FRAPPE_REDIS_PORT ? Number(process.env.FRAPPE_REDIS_PORT) : undefined;
      const frappePassword = process.env.FRAPPE_REDIS_PASSWORD || undefined;
      const frappeDb = process.env.FRAPPE_REDIS_DB ? Number(process.env.FRAPPE_REDIS_DB) : undefined;
      if (frappeUrl || frappeHost) {
        try {
          const secondaryOpts = frappeUrl
            ? { url: frappeUrl }
            : {
                socket: {
                  host: frappeHost || '127.0.0.1',
                  port: frappePort || 13000,
                },
                password: frappePassword,
                database: frappeDb,
              };
          this.secondarySubClient = createClient(secondaryOpts);
          this.secondarySubClient.on('error', (err) => console.error('[Ticket Service] Redis secondary-sub error:', err.message));
          this.secondarySubClient.on('ready', () => console.log('[Ticket Service] Redis secondary user-sub ready'));
          console.log('[Ticket Service] Connecting secondary subscriber to Frappe Redis:', frappeUrl || `${secondaryOpts.socket.host}:${secondaryOpts.socket.port}`);
          await this.secondarySubClient.connect();
        } catch (secErr) {
          console.warn('⚠️ [Ticket Service] Could not connect secondary subscriber to Frappe Redis:', secErr.message);
        }
      }
    } catch (error) {
      console.error('❌ [Ticket Service] Redis connection failed:', error.message);
      throw error;
    }
  }

  async set(key, value, ttl = null) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
    if (ttl) {
      await this.client.setEx(key, ttl, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async get(key) {
    const value = await this.client.get(key);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async del(key) {
    await this.client.del(key);
  }

  async publish(channel, message) {
    const stringMessage = typeof message === 'object' ? JSON.stringify(message) : message;
    await this.pubClient.publish(channel, stringMessage);
  }

  async subscribe(channel, callback) {
    console.log(`[Ticket Service] Subscribing to channel: ${channel}`);
    await this.userSubClient.subscribe(channel, (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        if (process.env.DEBUG_USER_EVENTS === '1') {
          console.log('[Ticket Service] Message received on', channel, '=>', typeof parsedMessage === 'object' ? Object.keys(parsedMessage) : typeof parsedMessage);
        }
        callback(parsedMessage);
      } catch {
        if (process.env.DEBUG_USER_EVENTS === '1') {
          console.log('[Ticket Service] Raw message received on', channel);
        }
        callback(message);
      }
    });
  }

  async subscribeMulti(channel, callback) {
    console.log(`[Ticket Service] Subscribing (multi) to channel: ${channel}`);
    await this.subscribe(channel, callback);
    if (this.secondarySubClient) {
      await this.secondarySubClient.subscribe(channel, (message) => {
        try {
          const parsedMessage = JSON.parse(message);
          if (process.env.DEBUG_USER_EVENTS === '1') {
            console.log('[Ticket Service] (secondary) Message received on', channel, '=>', typeof parsedMessage === 'object' ? Object.keys(parsedMessage) : typeof parsedMessage);
          }
          callback(parsedMessage);
        } catch {
          if (process.env.DEBUG_USER_EVENTS === '1') {
            console.log('[Ticket Service] (secondary) Raw message received on', channel);
          }
          callback(message);
        }
      });
    }
  }

  // Ticket-specific cache methods
  async cacheTicket(ticketId, ticket) {
    const key = `ticket:${ticketId}`;
    await this.set(key, ticket, 1800); // Cache for 30 minutes
  }

  async getCachedTicket(ticketId) {
    const key = `ticket:${ticketId}`;
    return await this.get(key);
  }

  async invalidateTicketCache(ticketId) {
    const key = `ticket:${ticketId}`;
    await this.del(key);
  }

  // User tickets cache
  async cacheUserTickets(userId, tickets, type = 'created') {
    const key = `user_tickets:${userId}:${type}`;
    await this.set(key, tickets, 900); // Cache for 15 minutes
  }

  async getCachedUserTickets(userId, type = 'created') {
    const key = `user_tickets:${userId}:${type}`;
    return await this.get(key);
  }

  async invalidateUserTicketsCache(userId) {
    const keys = [`user_tickets:${userId}:created`, `user_tickets:${userId}:assigned`];
    for (const key of keys) {
      await this.del(key);
    }
  }

  // Ticket stats cache
  async cacheTicketStats(stats) {
    const key = 'ticket_stats';
    await this.set(key, stats, 300); // Cache for 5 minutes
  }

  async getCachedTicketStats() {
    const key = 'ticket_stats';
    return await this.get(key);
  }

  async invalidateTicketStatsCache() {
    const key = 'ticket_stats';
    await this.del(key);
  }

  // Real-time ticket updates
  async publishTicketUpdate(ticketId, update) {
    await this.publish(`ticket:${ticketId}:updates`, update);
  }

  async subscribeToTicketUpdates(ticketId, callback) {
    await this.subscribe(`ticket:${ticketId}:updates`, callback);
  }

  // Support agent availability
  async setAgentOnline(agentId) {
    const key = `agent:online:${agentId}`;
    await this.set(key, { status: 'online', lastSeen: new Date().toISOString() }, 300);
  }

  async setAgentOffline(agentId) {
    const key = `agent:online:${agentId}`;
    await this.del(key);
  }

  async getOnlineAgents() {
    const pattern = 'agent:online:*';
    const keys = await this.client.keys(pattern);
    const agents = [];
    
    for (const key of keys) {
      const agentId = key.split(':')[2];
      const data = await this.get(key);
      agents.push({ agentId, ...data });
    }
    
    return agents;
  }

  getPubClient() {
    return this.pubClient;
  }

  getSubClient() {
    return this.subClient;
  }
}

module.exports = new RedisClient();