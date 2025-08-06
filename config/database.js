const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      // Sử dụng MongoDB local cho ticket service  
      const uri = process.env.MONGODB_URI || 
        `mongodb://${process.env.MONGODB_HOST || 'localhost'}:${process.env.MONGODB_PORT || 27017}/${process.env.MONGODB_DATABASE || 'wellspring_tickets'}`;

      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
      };

      // Add authentication if credentials are provided
      if (process.env.MONGODB_USER && process.env.MONGODB_PASSWORD) {
        options.auth = {
          username: process.env.MONGODB_USER,
          password: process.env.MONGODB_PASSWORD,
        };
      }

      console.log(`🔗 [Ticket Service] Connecting to MongoDB: ${uri}`);
      this.connection = await mongoose.connect(uri, options);
      
      console.log('✅ [Ticket Service] MongoDB local connection established successfully');
      console.log(`📊 [Ticket Service] Database: ${mongoose.connection.name}`);
      
      // Handle connection events
      mongoose.connection.on('error', (err) => {
        console.error('❌ [Ticket Service] MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ [Ticket Service] MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 [Ticket Service] MongoDB reconnected');
      });

    } catch (error) {
      console.error('❌ [Ticket Service] MongoDB connection failed:', error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      console.log('🔌 [Ticket Service] MongoDB disconnected');
    }
  }

  getConnection() {
    return mongoose.connection;
  }

  // Helper method to check if connected
  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  // Health check
  async healthCheck() {
    try {
      if (!this.isConnected()) {
        throw new Error('Database not connected');
      }
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}

module.exports = new Database();