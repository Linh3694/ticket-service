const database = require('../config/database');
const redisClient = require('../config/redis');
const nodemailer = require('nodemailer');
const moment = require('moment');

class TicketController {
  constructor() {
    this.emailTransporter = null;
    this.initEmailTransporter();
  }

  initEmailTransporter() {
    if (process.env.SMTP_HOST) {
      this.emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
  }

  // Create ticket (Frappe compatible)
  async createTicket(req, res) {
    try {
      const { 
        title, 
        description, 
        ticket_type = 'support', 
        priority = 'medium', 
        category = null,
        attachments = null,
        tags = null
      } = req.body;

      if (!title || !description) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'title and description are required'
        });
      }

      // Create ticket record
      const ticketData = {
        name: `TICKET-${Date.now()}`,
        title,
        description,
        ticket_type,
        priority,
        status: 'open',
        creator: req.user?.name || 'Administrator',
        category,
        attachments: attachments ? JSON.stringify(attachments) : null,
        tags: tags ? JSON.stringify(tags) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        owner: req.user?.name || 'Administrator',
        modified_by: req.user?.name || 'Administrator',
        docstatus: 0,
        idx: 0
      };

      await database.insert('ERP Ticket', ticketData);

      // Cache the ticket
      await redisClient.cacheTicket(ticketData.name, ticketData);

      // Invalidate user tickets cache
      await redisClient.invalidateUserTicketsCache(ticketData.creator);
      await redisClient.invalidateTicketStatsCache();

      // Send notification to IT Support team
      await this.notifyITSupport('created', ticketData);

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.emit('ticket_created', {
          ticket: ticketData,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        message: ticketData,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in createTicket:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get tickets with filters
  async getTickets(req, res) {
    try {
      const { 
        status, 
        priority, 
        ticket_type, 
        creator, 
        assigned_to, 
        category,
        limit = 50,
        search
      } = req.query;

      let tickets;

      if (search) {
        // Search tickets
        const filters = {};
        if (status) filters.status = status;
        if (priority) filters.priority = priority;
        if (ticket_type) filters.ticket_type = ticket_type;
        if (creator) filters.creator = creator;
        if (assigned_to) filters.assigned_to = assigned_to;
        if (category) filters.category = category;

        tickets = await database.searchTickets(search, filters, parseInt(limit));
      } else {
        // Regular filtered query
        const filters = {};
        if (status) filters.status = status;
        if (priority) filters.priority = priority;
        if (ticket_type) filters.ticket_type = ticket_type;
        if (creator) filters.creator = creator;
        if (assigned_to) filters.assigned_to = assigned_to;
        if (category) filters.category = category;

        tickets = await database.getAll('ERP Ticket',
          filters,
          '*',
          'created_at DESC',
          parseInt(limit)
        );
      }

      res.json({
        message: tickets,
        status: 'success',
        total: tickets.length
      });

    } catch (error) {
      console.error('Error in getTickets:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get single ticket
  async getTicket(req, res) {
    try {
      const { ticket_id } = req.params;

      // Check cache first
      let ticket = await redisClient.getCachedTicket(ticket_id);

      if (!ticket) {
        ticket = await database.get('ERP Ticket', ticket_id);
        
        if (!ticket) {
          return res.status(404).json({
            error: 'Ticket not found',
            message: `Ticket ${ticket_id} not found`
          });
        }

        // Cache the ticket
        await redisClient.cacheTicket(ticket_id, ticket);
      }

      res.json({
        message: ticket,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in getTicket:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Update ticket
  async updateTicket(req, res) {
    try {
      const { ticket_id } = req.params;
      const updateData = req.body;

      // Get current ticket
      const currentTicket = await database.get('ERP Ticket', ticket_id);
      
      if (!currentTicket) {
        return res.status(404).json({
          error: 'Ticket not found',
          message: `Ticket ${ticket_id} not found`
        });
      }

      // Update timestamps based on status changes
      if (updateData.status && updateData.status !== currentTicket.status) {
        if (updateData.status === 'resolved' && !currentTicket.resolved_at) {
          updateData.resolved_at = new Date().toISOString();
        } else if (updateData.status === 'closed' && !currentTicket.closed_at) {
          updateData.closed_at = new Date().toISOString();
        }
      }

      updateData.updated_at = new Date().toISOString();
      updateData.modified = new Date().toISOString();
      updateData.modified_by = req.user?.name || 'Administrator';

      await database.update('ERP Ticket', ticket_id, updateData);

      // Get updated ticket
      const updatedTicket = await database.get('ERP Ticket', ticket_id);

      // Update cache
      await redisClient.cacheTicket(ticket_id, updatedTicket);
      await redisClient.invalidateUserTicketsCache(updatedTicket.creator);
      if (updatedTicket.assigned_to) {
        await redisClient.invalidateUserTicketsCache(updatedTicket.assigned_to);
      }
      await redisClient.invalidateTicketStatsCache();

      // Send notifications for status changes
      if (updateData.status && updateData.status !== currentTicket.status) {
        await this.notifyStatusChange(updatedTicket, currentTicket.status, updateData.status);
      }

      if (updateData.assigned_to && updateData.assigned_to !== currentTicket.assigned_to) {
        await this.notifyAssignment(updatedTicket);
      }

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.emit('ticket_updated', {
          ticket: updatedTicket,
          changes: updateData,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        message: updatedTicket,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in updateTicket:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Assign ticket to user
  async assignTicket(req, res) {
    try {
      const { ticket_id } = req.params;
      const { assigned_to } = req.body;

      if (!assigned_to) {
        return res.status(400).json({
          error: 'Missing assigned_to field'
        });
      }

      const updateData = {
        assigned_to,
        status: 'in_progress',
        updated_at: new Date().toISOString(),
        modified: new Date().toISOString(),
        modified_by: req.user?.name || 'Administrator'
      };

      await database.update('ERP Ticket', ticket_id, updateData);

      // Get updated ticket
      const updatedTicket = await database.get('ERP Ticket', ticket_id);

      // Update cache
      await redisClient.cacheTicket(ticket_id, updatedTicket);
      await redisClient.invalidateUserTicketsCache(updatedTicket.creator);
      await redisClient.invalidateUserTicketsCache(assigned_to);
      await redisClient.invalidateTicketStatsCache();

      // Send notification
      await this.notifyAssignment(updatedTicket);

      res.json({
        message: updatedTicket,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in assignTicket:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Resolve ticket
  async resolveTicket(req, res) {
    try {
      const { ticket_id } = req.params;
      const { resolution } = req.body;

      if (!resolution) {
        return res.status(400).json({
          error: 'Resolution is required'
        });
      }

      const updateData = {
        resolution,
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        modified: new Date().toISOString(),
        modified_by: req.user?.name || 'Administrator'
      };

      await database.update('ERP Ticket', ticket_id, updateData);

      // Get updated ticket
      const updatedTicket = await database.get('ERP Ticket', ticket_id);

      // Update cache
      await redisClient.cacheTicket(ticket_id, updatedTicket);
      await redisClient.invalidateUserTicketsCache(updatedTicket.creator);
      if (updatedTicket.assigned_to) {
        await redisClient.invalidateUserTicketsCache(updatedTicket.assigned_to);
      }
      await redisClient.invalidateTicketStatsCache();

      // Send notification
      await this.notifyStatusChange(updatedTicket, 'in_progress', 'resolved');

      res.json({
        message: updatedTicket,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in resolveTicket:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get user tickets
  async getUserTickets(req, res) {
    try {
      const { user_id } = req.params;
      const { type = 'created', status, limit = 50 } = req.query;

      // Check cache first
      let tickets = await redisClient.getCachedUserTickets(user_id, type);

      if (!tickets) {
        const filters = {};
        
        if (type === 'created') {
          filters.creator = user_id;
        } else if (type === 'assigned') {
          filters.assigned_to = user_id;
        }

        if (status) {
          filters.status = status;
        }

        tickets = await database.getAll('ERP Ticket',
          filters,
          ['name', 'title', 'status', 'priority', 'created_at', 'assigned_to', 'creator'],
          'created_at DESC',
          parseInt(limit)
        );

        // Cache the results
        await redisClient.cacheUserTickets(user_id, tickets, type);
      }

      res.json({
        message: tickets,
        status: 'success',
        total: tickets.length
      });

    } catch (error) {
      console.error('Error in getUserTickets:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get ticket statistics
  async getTicketStats(req, res) {
    try {
      const { start_date, end_date, user } = req.query;

      // Check cache first
      let stats = await redisClient.getCachedTicketStats();

      if (!stats) {
        const filters = {};
        
        if (start_date && end_date) {
          filters.created_at = ['between', start_date, end_date];
        }
        
        if (user) {
          filters.creator = user;
        }

        const dbStats = await database.getTicketStats(filters);
        const tickets = await database.getAll('ERP Ticket', filters);

        stats = {
          total: tickets.length,
          by_status: {},
          by_priority: {},
          by_type: {},
          avg_resolution_time: 0,
          open_tickets: tickets.filter(t => t.status === 'open').length,
          in_progress_tickets: tickets.filter(t => t.status === 'in_progress').length,
          resolved_tickets: tickets.filter(t => t.status === 'resolved').length,
          closed_tickets: tickets.filter(t => t.status === 'closed').length
        };

        // Process database stats
        dbStats.forEach(stat => {
          stats.by_status[stat.status] = stat.count;
          stats.by_priority[stat.priority] = (stats.by_priority[stat.priority] || 0) + stat.count;
          stats.by_type[stat.ticket_type] = (stats.by_type[stat.ticket_type] || 0) + stat.count;
          
          if (stat.avg_resolution_time) {
            stats.avg_resolution_time = Math.max(stats.avg_resolution_time, stat.avg_resolution_time);
          }
        });

        // Cache the stats
        await redisClient.cacheTicketStats(stats);
      }

      res.json({
        message: stats,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in getTicketStats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Notification methods
  async notifyITSupport(action, ticket) {
    try {
      // This would integrate with the notification service
      console.log(`📧 [Ticket Service] Notifying IT Support: ${action} - ${ticket.title}`);
      
      // Could make API call to notification service here
      // await axios.post('http://localhost:5003/api/notifications/create', {
      //   title: `New Ticket: ${ticket.title}`,
      //   message: `Ticket ${ticket.name} has been created`,
      //   recipients: ['it-support-team'],
      //   notification_type: 'system'
      // });
      
    } catch (error) {
      console.error('Error notifying IT Support:', error);
    }
  }

  async notifyStatusChange(ticket, oldStatus, newStatus) {
    try {
      console.log(`📧 [Ticket Service] Status changed: ${ticket.name} from ${oldStatus} to ${newStatus}`);
      
      // Notify ticket creator
      // await notificationService.notify(ticket.creator, {
      //   title: `Ticket ${ticket.name}: Status Updated`,
      //   message: `Your ticket status has been changed to: ${newStatus}`
      // });
      
    } catch (error) {
      console.error('Error notifying status change:', error);
    }
  }

  async notifyAssignment(ticket) {
    try {
      console.log(`📧 [Ticket Service] Ticket assigned: ${ticket.name} to ${ticket.assigned_to}`);
      
      // Notify assigned user
      // await notificationService.notify(ticket.assigned_to, {
      //   title: `Ticket Assigned: ${ticket.title}`,
      //   message: `You have been assigned to ticket: ${ticket.name}`
      // });
      
    } catch (error) {
      console.error('Error notifying assignment:', error);
    }
  }
}

module.exports = new TicketController();