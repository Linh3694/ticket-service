const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.pubClient = null;
    this.subClient = null;
  }

  async connect() {
    try {
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD,
      });

      this.pubClient = createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD,
      });

      this.subClient = this.pubClient.duplicate();

      await this.client.connect();
      await this.pubClient.connect();
      await this.subClient.connect();

      console.log('✅ [Ticket Service] Redis connected successfully');
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
    await this.subClient.subscribe(channel, (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        callback(parsedMessage);
      } catch {
        callback(message);
      }
    });
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