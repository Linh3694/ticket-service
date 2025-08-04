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
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
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

// Health check
app.get('/health', async (req, res) => {
  try {
    await database.query('SELECT 1');
    await redisClient.client.ping();
    
    res.status(200).json({ 
      status: 'ok', 
      service: 'ticket-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: 'connected',
      redis: 'connected'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'ticket-service',
      error: error.message
    });
  }
});

// Import routes
const ticketRoutes = require('./routes/ticketRoutes');

// Use routes
app.use("/api/tickets", ticketRoutes);
app.use("/api/method", ticketRoutes);
app.use("/api/resource", ticketRoutes);

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
server.listen(PORT, () => {
  console.log(`🚀 [Ticket Service] Server running on port ${PORT}`);
});

connectDB();

module.exports = { app, io, server };