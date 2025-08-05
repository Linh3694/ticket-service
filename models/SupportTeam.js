const mongoose = require('mongoose');

const supportTeamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    default: ''
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['member', 'admin', 'lead'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  settings: {
    autoAssign: {
      type: Boolean,
      default: true
    },
    maxTicketsPerMember: {
      type: Number,
      default: 10
    },
    workingHours: {
      start: {
        type: String,
        default: '08:00'
      },
      end: {
        type: String,
        default: '17:00'
      }
    }
  },
  categories: [{
    type: String
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Static methods
supportTeamSchema.statics.getSupportTeamMembers = async function() {
  const team = await this.findOne({ isActive: true })
    .populate('members.user', 'fullname email role department avatarUrl')
    .populate('members.user', 'fullname email role department avatarUrl');
  
  if (!team) {
    return { members: [] };
  }
  
  return {
    members: team.members.filter(member => member.isActive)
  };
};

supportTeamSchema.statics.addMember = async function(userId) {
  let team = await this.findOne({ isActive: true });
  
  if (!team) {
    // Create default team if none exists
    team = new this({
      name: 'Default Support Team',
      description: 'Default support team for ticket management'
    });
  }
  
  // Check if user is already a member
  const existingMember = team.members.find(member => 
    member.user.toString() === userId.toString()
  );
  
  if (existingMember) {
    if (existingMember.isActive) {
      throw new Error('User is already an active member of the support team');
    } else {
      existingMember.isActive = true;
      existingMember.joinedAt = new Date();
    }
  } else {
    team.members.push({
      user: userId,
      role: 'member',
      joinedAt: new Date(),
      isActive: true
    });
  }
  
  await team.save();
  return 'User added to support team successfully';
};

supportTeamSchema.statics.removeMember = async function(userId, currentUser) {
  const team = await this.findOne({ isActive: true });
  
  if (!team) {
    throw new Error('No active support team found');
  }
  
  const member = team.members.find(m => 
    m.user.toString() === userId.toString()
  );
  
  if (!member) {
    throw new Error('User is not a member of the support team');
  }
  
  // Only allow removal if current user is admin or the member themselves
  const currentUserMember = team.members.find(m => 
    m.user.toString() === currentUser._id.toString()
  );
  
  if (!currentUserMember || 
      (currentUserMember.role !== 'admin' && 
       currentUserMember.role !== 'lead' && 
       currentUser._id.toString() !== userId.toString())) {
    throw new Error('Insufficient permissions to remove member');
  }
  
  member.isActive = false;
  await team.save();
  
  return 'User removed from support team successfully';
};

module.exports = mongoose.model('SupportTeam', supportTeamSchema); 