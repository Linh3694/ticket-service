const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  fileUrl: {
    type: String,
    default: ''
  },
  fileName: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  isRead: {
    type: Boolean,
    default: false
  }
});

const chatSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  avatar: {
    type: String,
    default: ''
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  messages: [messageSchema],
  settings: {
    allowMembersToAdd: {
      type: Boolean,
      default: false
    },
    allowMembersToEdit: {
      type: Boolean,
      default: false
    },
    muteNotifications: {
      type: Boolean,
      default: false
    }
  },
  lastMessage: {
    type: Date,
    default: null
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  }
}, {
  timestamps: true
});

// Indexes for better performance
chatSchema.index({ participants: 1 });
chatSchema.index({ creator: 1 });
chatSchema.index({ isGroup: 1 });
chatSchema.index({ lastMessage: -1 });

module.exports = mongoose.model('Chat', chatSchema); 