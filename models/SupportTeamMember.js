const mongoose = require('mongoose');

// Định nghĩa các role/category hỗ trợ
const SUPPORT_ROLES = [
  'Overall', // Vấn đề chung
  'Account', // Tài khoản
  'Camera System', // Hệ thống Camera
  'Network System', // Hệ thống mạng
  'Bell System', // Hệ thống chuông báo
  'Software' // Phần mềm
];

const supportTeamMemberSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
    fullname: {
    type: String,
    required: true
  },
  
  email: {
    type: String,
    required: true
  },
  
  avatarUrl: {
    type: String,
    default: ''
  },
  
  department: {
    type: String,
    default: ''
  },
  
  // Các role/category mà member phụ trách
  roles: [{
    type: String,
    enum: SUPPORT_ROLES
  }],
  
  // Trạng thái
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Thống kê
  stats: {
    totalTickets: {
      type: Number,
      default: 0
    },
    resolvedTickets: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0
    }
  },
  
  // Notes
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes
supportTeamMemberSchema.index({ userId: 1, isActive: 1 });
supportTeamMemberSchema.index({ roles: 1 });
supportTeamMemberSchema.index({ 'stats.totalTickets': -1 });

// Static methods

// Lấy tất cả members
supportTeamMemberSchema.statics.getAllMembers = async function(filters = {}) {
  const query = { isActive: true, ...filters };
  return await this.find(query).sort({ fullname: 1 });
};

// Lấy member theo userId
supportTeamMemberSchema.statics.getMemberByUserId = async function(userId) {
  return await this.findOne({ userId, isActive: true });
};

// Lấy members theo role
supportTeamMemberSchema.statics.getMembersByRole = async function(role) {
  return await this.find({ 
    roles: role, 
    isActive: true 
  }).sort({ fullname: 1 });
};

// Tạo hoặc cập nhật member
supportTeamMemberSchema.statics.createOrUpdate = async function(memberData) {
  const { userId, fullname, email, avatarUrl, department, roles, notes } = memberData;
  
  // Validate roles
  if (roles && roles.length > 0) {
    const invalidRoles = roles.filter(role => !SUPPORT_ROLES.includes(role));
    if (invalidRoles.length > 0) {
      throw new Error(`Invalid roles: ${invalidRoles.join(', ')}`);
    }
  }
  
  const existingMember = await this.findOne({ userId });
  
  if (existingMember) {
    // Update existing member
    existingMember.fullname = fullname;
    existingMember.email = email;
    existingMember.avatarUrl = avatarUrl || existingMember.avatarUrl;
    existingMember.department = department || existingMember.department;
    existingMember.roles = roles || existingMember.roles;
    existingMember.notes = notes !== undefined ? notes : existingMember.notes;
    existingMember.isActive = true;
    
    await existingMember.save();
    return existingMember;
  } else {
    // Create new member
    const newMember = new this({
      userId,
      fullname,
      email,
      avatarUrl: avatarUrl || '',
      department: department || '',
      roles: roles || [],
      notes: notes || '',
      isActive: true
    });
    
    await newMember.save();
    return newMember;
  }
};

// Xóa member (soft delete)
supportTeamMemberSchema.statics.removeMember = async function(userId) {
  const member = await this.findOne({ userId });
  
  if (!member) {
    throw new Error('Member not found');
  }
  
  member.isActive = false;
  await member.save();
  
  return 'Member removed successfully';
};

// Cập nhật stats
supportTeamMemberSchema.methods.updateStats = async function(stats) {
  if (stats.totalTickets !== undefined) {
    this.stats.totalTickets = stats.totalTickets;
  }
  if (stats.resolvedTickets !== undefined) {
    this.stats.resolvedTickets = stats.resolvedTickets;
  }
  if (stats.averageRating !== undefined) {
    this.stats.averageRating = stats.averageRating;
  }
  
  await this.save();
};

// Virtual for role labels
supportTeamMemberSchema.virtual('roleLabels').get(function() {
  const roleMap = {
    'Overall': 'Vấn đề chung',
    'Account': 'Tài khoản',
    'Camera System': 'Hệ thống Camera',
    'Network System': 'Hệ thống mạng',
    'Bell System': 'Hệ thống chuông báo',
    'Software': 'Phần mềm'
  };
  
  return this.roles.map(role => roleMap[role] || role);
});

// Export constants
supportTeamMemberSchema.statics.SUPPORT_ROLES = SUPPORT_ROLES;

module.exports = mongoose.model('SupportTeamMember', supportTeamMemberSchema);

