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
const supportTeamRoutes = require('./routes/supportTeam');

// Import services
const notificationService = require('./services/notificationService');

// Use routes
app.use("/api/ticket", ticketRoutes);
app.use("/api/ticket/support-team", supportTeamRoutes);
app.use("/api/email", emailRoutes);

// Frappe compatible routes
app.use("/api/method", ticketRoutes);
app.use("/api/resource", ticketRoutes);

// Initialize services
(async () => {
  try {
    // Subscribe to chat events
    await chatService.subscribeToChatEvents();
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