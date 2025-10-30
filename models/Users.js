const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },

  phone: {
    type: String,
    trim: true,
    sparse: true
  },

  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },

  password: {
    type: String,
    minlength: 8,
    default: null
  },

  fullname: {
    type: String,
    required: true,
  },

  jobTitle: {
    type: String,
    default: "User",
  },

  department: {
    type: String,
    default: "Unknown",
  },

  // Legacy single role (kept for backward compatibility)
  role: {
    type: String,
    enum: [
      "admin", "teacher", "parent", "registrar", "admission", "bos", "principal", "service", "superadmin", "technical", "marcom", "hr", "bod", "user", "librarian"
    ],
    default: "user",
  },

  // New multi-roles synced from Frappe (e.g., ['IT Manager','IT Helpdesk'])
  roles: {
    type: [String],
    default: [],
  },

  disabled: {
    type: Boolean,
    default: false,
  },

  active: {
    type: Boolean,
    default: true
  },

  avatarUrl: {
    type: String,
    default: ""
  },

  lastLogin: {
    type: Date,
  },

  resetPasswordToken: String,
  resetPasswordExpire: Date,

  employeeCode: {
    type: String,
    unique: true,
    sparse: true
  },

  provider: {
    type: String,
    default: 'local'
  },

  microsoftId: {
    type: String,
    sparse: true
  },

  appleId: {
    type: String,
    sparse: true
  },

  lastSeen: {
    type: Date,
    default: Date.now
  },

  attendanceLog: [
    {
      time: { type: String },
      createdAt: { type: Date, default: Date.now },
    },
  ],

  deviceToken: {
    type: String
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true
});

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ employeeCode: 1 });
userSchema.index({ role: 1 });
userSchema.index({ roles: 1 });
userSchema.index({ active: 1 });

userSchema.pre('save', async function (next) {
  if (!this.password || !this.isModified('password')) {
    return next();
  }
  const isHashed = this.password.startsWith('$2a$') || this.password.startsWith('$2b$');
  if (!isHashed) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

userSchema.virtual('loginIdentifier').get(function() {
  return this.username || this.email;
});

userSchema.statics.findByLogin = function(identifier) {
  return this.findOne({
    $or: [
      { username: identifier },
      { email: identifier },
      { phone: identifier }
    ]
  });
};

// Method to sync user from Frappe (pattern từ inventory-service)
userSchema.statics.updateFromFrappe = async function updateFromFrappe(frappeUser) {
  if (!frappeUser || typeof frappeUser !== 'object') {
    throw new Error('Invalid Frappe user payload');
  }

  const email = frappeUser.email || frappeUser.user_id || frappeUser.username;
  if (!email) {
    throw new Error('User email is required');
  }

  const fullName = frappeUser.full_name || frappeUser.fullname || frappeUser.fullName ||
    [frappeUser.first_name, frappeUser.middle_name, frappeUser.last_name].filter(Boolean).join(' ') ||
    frappeUser.name;

  const roles = Array.isArray(frappeUser.roles)
    ? frappeUser.roles.map((r) => (typeof r === 'string' ? r : r?.role)).filter(Boolean)
    : Array.isArray(frappeUser.roles_list)
    ? frappeUser.roles_list
    : [];

  const update = {
    fullname: fullName,
    email: email,
    avatarUrl: frappeUser.user_image || frappeUser.avatar || frappeUser.avatar_url || '',
    department: frappeUser.department || 'Unknown',
    jobTitle: frappeUser.job_title || frappeUser.designation || 'User',
    roles: roles,
    role: roles.length > 0 ? roles[0].toLowerCase() : 'user', // Legacy single role
    disabled: frappeUser.disabled || !frappeUser.enabled,
    active: frappeUser.enabled || !frappeUser.disabled,
    provider: frappeUser.provider || 'frappe',
    microsoftId: frappeUser.microsoft_id || frappeUser.microsoftId,
    employeeCode: frappeUser.employee_code || frappeUser.employeeCode,
    updatedAt: new Date(),
  };

  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  const doc = await this.findOneAndUpdate({ email }, update, options);

  return doc;
};

module.exports = mongoose.model("User", userSchema);


