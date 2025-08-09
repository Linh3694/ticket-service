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

  role: {
    type: String,
    enum: [
      "admin", "teacher", "parent", "registrar", "admission", "bos", "principal", "service", "superadmin", "technical", "marcom", "hr", "bod", "user", "librarian"
    ],
    default: "user",
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

module.exports = mongoose.model("User", userSchema);


