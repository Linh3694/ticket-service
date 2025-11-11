const mongoose = require('mongoose');

// Định nghĩa các role/category hỗ trợ
const SUPPORT_ROLES = [
  'Overall', // Vấn đề chung
  'Account', // Tài khoản
  'Camera System', // Hệ thống Camera
  'Network System', // Hệ thống mạng
  'Bell System', // Hệ thống chuông báo
  'Software', // Phần mềm
  'Email Ticket' // Xử lý ticket từ email
];

const supportTeamMemberSchema = new mongoose.Schema({
  // Reference đến Users collection (email là unique identifier)
  email: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Reference ObjectId đến User collection (từ Frappe)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  
  // Các role/category mà member phụ trách (SUPPORT roles, khác với Frappe roles)
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
supportTeamMemberSchema.index({ email: 1, isActive: 1 });
supportTeamMemberSchema.index({ roles: 1 });
supportTeamMemberSchema.index({ 'stats.totalTickets': -1 });

// Static methods

// Helper: Populate user data từ Users collection
supportTeamMemberSchema.statics.populateUserData = async function(members) {
  const User = mongoose.model('User');
  
  if (!Array.isArray(members)) {
    members = [members];
  }
  
  const emails = members.map(m => m.email).filter(Boolean);
  const users = await User.find({ email: { $in: emails } })
    .select('_id email fullname avatarUrl department jobTitle')
    .lean();
  
  const userMap = new Map(users.map(u => [u.email, u]));
  
  return members.map(member => {
    const memberObj = member.toObject ? member.toObject() : member;
    const user = userMap.get(memberObj.email);
    
    return {
      ...memberObj,
      // Keep userId as email for frontend compatibility (combobox needs email to match options)
      userId: memberObj.email,
      // Populate từ Users collection
      fullname: user?.fullname || memberObj.email,
      avatarUrl: user?.avatarUrl || '',
      department: user?.department || '',
      jobTitle: user?.jobTitle || 'User',
      userObjectId: user?._id  // Store User._id separately if needed
    };
  });
};

// Lấy tất cả members (with user data populated)
supportTeamMemberSchema.statics.getAllMembers = async function(filters = {}) {
  const query = { isActive: true, ...filters };
  const members = await this.find(query).lean();
  return await this.populateUserData(members);
};

// Lấy member theo email
supportTeamMemberSchema.statics.getMemberByEmail = async function(email) {
  const member = await this.findOne({ email, isActive: true }).lean();
  if (!member) return null;
  
  const populated = await this.populateUserData([member]);
  return populated[0];
};

// Get member by userId (supports ObjectId, email, or userId string)
supportTeamMemberSchema.statics.getMemberByUserId = async function(userId) {
  let query = { isActive: true };

  // Check if userId is a valid ObjectId
  if (mongoose.Types.ObjectId.isValid(userId)) {
    // If valid ObjectId, try to find by _id first, then by userId field
    query = {
      $or: [
        { _id: new mongoose.Types.ObjectId(userId) },
        { userId: new mongoose.Types.ObjectId(userId) },
        { email: userId }
      ],
      isActive: true
    };
  } else {
    // If not ObjectId, search by email only (don't try to query userId field with string value)
    query = {
      email: userId,
      isActive: true
    };
  }

  const member = await this.findOne(query).lean();
  if (!member) return null;

  const populated = await this.populateUserData([member]);
  return populated[0];
};

// Lấy members theo role (with user data populated)
supportTeamMemberSchema.statics.getMembersByRole = async function(role) {
  const members = await this.find({ 
    roles: role, 
    isActive: true 
  }).lean();
  return await this.populateUserData(members);
};

// Tạo hoặc cập nhật member
supportTeamMemberSchema.statics.createOrUpdate = async function(memberData) {
  const { email, roles, notes, userId } = memberData;
  
  if (!email) {
    throw new Error('Email is required');
  }
  
  // Validate user exists trong Users collection
  const User = mongoose.model('User');
  const user = await User.findOne({ email }).select('_id email fullname');
  if (!user) {
    throw new Error(`User not found in Users collection: ${email}`);
  }
  
  // Validate roles
  if (roles && roles.length > 0) {
    const invalidRoles = roles.filter(role => !SUPPORT_ROLES.includes(role));
    if (invalidRoles.length > 0) {
      throw new Error(`Invalid roles: ${invalidRoles.join(', ')}`);
    }
  }
  
  const existingMember = await this.findOne({ email });
  
  if (existingMember) {
    // Update existing member
    existingMember.roles = roles || existingMember.roles;
    existingMember.notes = notes !== undefined ? notes : existingMember.notes;
    existingMember.userId = user._id; // Update with actual User ObjectId
    existingMember.isActive = true;
    
    await existingMember.save();
    
    // Populate and return
    const populated = await this.populateUserData([existingMember]);
    return populated[0];
  } else {
    // Create new member
    const newMember = new this({
      email,
      userId: user._id, // Store actual User ObjectId
      roles: roles || [],
      notes: notes || '',
      isActive: true
    });
    
    await newMember.save();
    
    // Populate and return
    const populated = await this.populateUserData([newMember]);
    return populated[0];
  }
};

// Xóa member (soft delete)
supportTeamMemberSchema.statics.removeMember = async function(emailOrUserId) {
  let query = {};
  
  // Check if emailOrUserId is a valid ObjectId
  if (mongoose.Types.ObjectId.isValid(emailOrUserId)) {
    query = {
      $or: [
        { _id: new mongoose.Types.ObjectId(emailOrUserId) },
        { userId: new mongoose.Types.ObjectId(emailOrUserId) }
      ]
    };
  } else {
    // If not ObjectId, search by email only
    query = { email: emailOrUserId };
  }
  
  const member = await this.findOne(query);
  
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

