const express = require("express");
const cors = require("cors");
const { Server } = require('socket.io');
const http = require('http');
const { createAdapter } = require('@socket.io/redis-adapter');
const path = require('path');
const fs = require('fs');
require("dotenv").config({ path: './config.env' });

// Import configurations
const database = require('./config/database');
const redisClient = require('./config/redis');

const app = express();
const server = http.createServer(app);

// Ensure upload directory exists
const uploadPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Socket.IO setup
const io = new Server(server, {
  cors: { origin: "*" },
  allowRequest: (req, callback) => {
    callback(null, true);
  },
});

// Make io accessible in controllers via req.app.get('io')
app.set('io', io);

// Setup Redis adapter
(async () => {
  try {
    console.log('🔗 [Ticket Service] Setting up Redis adapter...');
    await redisClient.connect();
    
    io.adapter(createAdapter(redisClient.getPubClient(), redisClient.getSubClient()));
    console.log('✅ [Ticket Service] Redis adapter setup complete');
  } catch (error) {
    console.warn('⚠️ [Ticket Service] Redis adapter setup failed:', error.message);
  }
})();

// Connect to MariaDB
const connectDB = async () => {
  try {
    await database.connect();
  } catch (error) {
    console.error('❌ [Ticket Service] Database connection failed:', error.message);
    process.exit(1);
  }
};

// Middleware
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use('/uploads', express.static(uploadPath));

// Add service info
app.use((req, res, next) => {
  res.setHeader('X-Service', 'ticket-service');
  res.setHeader('X-Service-Version', '1.0.0');
  next();
});

// Debug log incoming requests for auth troubleshooting
app.use((req, res, next) => {
  try {
    const auth = req.headers['authorization'];
    const path = req.originalUrl;
    console.log(`➡️  [Ticket Service] ${req.method} ${path} auth=${auth ? 'present' : 'missing'}`);
  } catch (_) {}
  next();
});

// Health check với kiểm tra tất cả services
app.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'ok',
      service: 'ticket-service',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    };

    // Kiểm tra database
    try {
      await database.healthCheck();
      healthStatus.database = 'connected';
    } catch (error) {
      healthStatus.database = 'error';
      healthStatus.database_error = error.message;
    }

    // Kiểm tra Redis
    try {
      await redisClient.client.ping();
      healthStatus.redis = 'connected';
    } catch (error) {
      healthStatus.redis = 'error';
      healthStatus.redis_error = error.message;
    }

    // Kiểm tra Chat service
    const chatHealth = await chatService.healthCheck();
    healthStatus.chat_service = chatHealth.status;
    if (chatHealth.status === 'error') {
      healthStatus.chat_error = chatHealth.message;
    }

    // Kiểm tra Notification service
    const notificationHealth = await notificationService.healthCheck();
    healthStatus.notification_service = notificationHealth.status;
    if (notificationHealth.status === 'error') {
      healthStatus.notification_error = notificationHealth.message;
    }

    // Xác định status tổng thể
    const criticalServices = ['database', 'redis'];
    const hasCriticalError = criticalServices.some(service => 
      healthStatus[service] === 'error'
    );

    if (hasCriticalError) {
      healthStatus.status = 'degraded';
      res.status(503).json(healthStatus);
    } else {
      res.status(200).json(healthStatus);
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'ticket-service',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Import routes
const ticketRoutes = require('./routes/tickets');
const emailRoutes = require('./routes/emailRoutes');

// Import services
const notificationService = require('./services/notificationService');
const chatService = require('./services/chatService');

// Use routes
app.use("/api/ticket", ticketRoutes);
// Backward-compatible alias for clients using plural path
app.use("/api/tickets", ticketRoutes);
app.use("/api/email", emailRoutes);

// Frappe compatible routes
app.use("/api/method", ticketRoutes);
app.use("/api/resource", ticketRoutes);

// Initialize services
(async () => {
  try {
    // Subscribe to chat events
    await chatService.subscribeToChatEvents();

    // Subscribe to user/role events via Redis
    const redisClient = require('./config/redis');
    // Ensure Redis is connected before subscribing (avoid race with adapter init)
    async function waitForRedisReady(maxMs = 15000) {
      const start = Date.now();
      while (true) {
        try {
          if (
            redisClient.pubClient && redisClient.pubClient.isOpen &&
            redisClient.subClient && redisClient.subClient.isOpen &&
            redisClient.userSubClient && redisClient.userSubClient.isOpen
          ) {
            return;
          }
        } catch (_) {}
        if (Date.now() - start > maxMs) {
          console.warn('⚠️ [Ticket Service] Redis not ready after wait, proceeding to subscribe anyway');
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await waitForRedisReady();
    const axios = require('axios');
    const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';
    function buildFrappeHeaders() {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (process.env.FRAPPE_API_KEY && process.env.FRAPPE_API_SECRET) {
        headers['Authorization'] = `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`;
        return headers;
      }
      if (process.env.FRAPPE_API_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.FRAPPE_API_TOKEN}`;
        headers['X-Frappe-CSRF-Token'] = process.env.FRAPPE_API_TOKEN;
        return headers;
      }
      return headers;
    }
    const userChannel = process.env.REDIS_USER_CHANNEL || 'user_events';
    // Subscribe on both primary Redis and optional Frappe Redis (if configured)
    const subscribeFn = redisClient.subscribeMulti ? redisClient.subscribeMulti.bind(redisClient) : redisClient.subscribe.bind(redisClient);
    await subscribeFn(userChannel, async (msg) => {
      try {
        const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
        if (!data || !data.type) return;
        if (process.env.DEBUG_USER_EVENTS === '1') {
          console.log('[Ticket Service] user_event received:', { type: data.type, hasUser: !!data.user, keys: Object.keys(data || {}) });
        }
        const Users = require('./models/Users');
        switch (data.type) {
          case 'user_created':
          case 'user_updated': {
            const u = data.user || data.data || {};
            // Always-on concise log (even when DEBUG is off)
            try {
              const identifier = u.email || u.name || data.user_id || data.userId || 'unknown';
              console.log(`[Ticket Service] user_event ${data.type}: ${identifier}`);
            } catch (_) {}
            // If only name provided, try fetch from Frappe to get email
            if (!u.email && (u.name || data.user_id)) {
              const userId = u.name || data.user_id;
              try {
                const resp = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${userId}`, { headers: buildFrappeHeaders(), params: { fields: JSON.stringify(['name','email','full_name','user_image','enabled','department']) } });
                Object.assign(u, resp.data?.data || {});
              } catch {}
            }
            if (!u.email && !u.name) return;
            // Upsert user + roles[]
            const update = {
              email: u.email,
              fullname: u.full_name || u.fullname || u.name,
              avatarUrl: u.user_image || '',
              department: u.department || '',
            };
            // Derive active: prefer explicit 'enabled' from Frappe User, fallback to provided 'active', default true
            try {
              if (typeof u.enabled !== 'undefined') {
                update.active = (u.enabled === 1 || u.enabled === true);
                update.disabled = !update.active;
              } else if (typeof u.active !== 'undefined') {
                update.active = !!u.active;
                update.disabled = !update.active;
              }
            } catch (_) {}
            // Normalize roles to array of strings
            try {
              let rolesRaw = u.roles;
              if (typeof rolesRaw === 'string') {
                // Try strict JSON first
                try {
                  rolesRaw = JSON.parse(rolesRaw);
                } catch {
                  // Fallback: extract role names from string like "[ { role: 'Teacher' }, ... ]"
                  const extracted = [];
                  const regex = /role\s*:\s*['\"]([^'\"]+)['\"]/g;
                  let match;
                  while ((match = regex.exec(rolesRaw)) !== null) {
                    extracted.push(match[1]);
                  }
                  rolesRaw = extracted;
                }
              }
              if (Array.isArray(rolesRaw)) {
                const normalized = rolesRaw
                  .map((item) => {
                    if (!item) return null;
                    if (typeof item === 'string') return item;
                    if (typeof item === 'object') return item.role || item.name || item.value || null;
                    return null;
                  })
                  .filter((v) => typeof v === 'string' && v.trim().length > 0)
                  .map((v) => v.trim());
                if (normalized.length > 0) {
                  // de-duplicate while preserving order
                  update.roles = Array.from(new Set(normalized));
                }
              }
            } catch (_) {
              // ignore role normalization errors
            }
            await Users.findOneAndUpdate(
              { email: u.email || u.name },
              { $set: update },
              { upsert: true, new: true }
            );
            try {
              console.log(`[Ticket Service] user upserted: ${u.email || u.name}`);
            } catch (_) {}
            break;
          }
          case 'frappe_doc_event': {
            // Generic ERP doc event adapter
            const { doctype, event, doc } = data;
             if (doctype === 'User' && doc) {
              const email = doc.email || doc.name;
              if (!email) break;
              await Users.findOneAndUpdate(
                { email },
                {
                  $set: {
                    email,
                    fullname: doc.full_name || doc.name,
                    avatarUrl: doc.user_image || '',
                    department: doc.department || '',
                     active: doc.enabled === 1 || doc.enabled === true,
                     disabled: !(doc.enabled === 1 || doc.enabled === true),
                  },
                },
                { upsert: true, new: true }
              );
            }
            if (doctype === 'Has Role' && doc) {
              const email = doc.parent; // in Frappe, parent of Has Role is User.name (often email)
              const role = doc.role;
              if (!email || !role) break;
              if (event === 'after_insert' || event === 'on_update' || data.action === 'assigned') {
                await Users.updateOne({ email }, { $addToSet: { roles: role } });
              } else if (event === 'on_trash' || data.action === 'removed' || data.deleted === true) {
                await Users.updateOne({ email }, { $pull: { roles: role } });
              }
            }
            break;
          }
          case 'user_role_assigned': {
            const { email, role } = data;
            if (!email || !role) return;
            await Users.updateOne(
              { email },
              { $addToSet: { roles: role } }
            );
            break;
          }
          case 'user_role_removed': {
            const { email, role } = data;
            if (!email || !role) return;
            await Users.updateOne(
              { email },
              { $pull: { roles: role } }
            );
            break;
          }
          default:
            if (process.env.DEBUG_USER_EVENTS === '1') {
              console.log('[Ticket Service] Unhandled user event type:', data.type);
            }
            break;
        }
      } catch (e) {
        console.warn('⚠️ [Ticket Service] Error handling user event:', e.message);
      }
    });

    // Optional: self-test publish to verify subscription path end-to-end
    if (process.env.USER_EVENTS_SELF_TEST === '1') {
      try {
        const payload = { type: 'user_events_self_test', source: 'ticket-service', ts: new Date().toISOString() };
        await redisClient.publish(userChannel, payload);
        console.log('[Ticket Service] Published self-test event to', userChannel);
      } catch (e) {
        console.warn('[Ticket Service] Failed to publish self-test event:', e.message);
      }
    }
    console.log('✅ [Ticket Service] Services initialized successfully');
  } catch (error) {
    console.error('❌ [Ticket Service] Error initializing services:', error);
  }
})();

// Socket.IO events
io.on('connection', (socket) => {
  console.log('🔌 [Ticket Service] Client connected:', socket.id);
  
  socket.on('join_ticket_room', (data) => {
    const { ticketId } = data;
    socket.join(`ticket:${ticketId}`);
  });
  
  socket.on('leave_ticket_room', (data) => {
    const { ticketId } = data;
    socket.leave(`ticket:${ticketId}`);
  });
  
  socket.on('agent_online', async (data) => {
    const { agentId } = data;
    await redisClient.setAgentOnline(agentId);
    socket.broadcast.emit('agent_status_changed', { agentId, status: 'online' });
  });
  
  socket.on('agent_offline', async (data) => {
    const { agentId } = data;
    await redisClient.setAgentOffline(agentId);
    socket.broadcast.emit('agent_status_changed', { agentId, status: 'offline' });
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 [Ticket Service] Client disconnected:', socket.id);
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ [Ticket Service] Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    service: 'ticket-service'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'ticket-service',
    path: req.originalUrl
  });
});

// Start server
const PORT = process.env.PORT || 5004;
const INSTANCE_ID = process.env.INSTANCE_ID || 0;

// Nếu chạy multiple instances, mỗi instance sẽ dùng port khác nhau
const instancePort = parseInt(PORT) + parseInt(INSTANCE_ID);

server.listen(instancePort, () => {
  console.log(`🚀 [Ticket Service] Instance ${INSTANCE_ID} running on port ${instancePort}`);
});

connectDB();

module.exports = { app, io, server };