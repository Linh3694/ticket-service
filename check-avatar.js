const mongoose = require('mongoose');
const User = require('./models/Users');

// Connect to database
async function checkUserAvatar() {
  try {
    // Connect to MongoDB (adjust connection string as needed)
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ticket-service');

    console.log('🔍 Checking user avatar in database...');

    // Find user by email
    const user = await User.findOne({ email: 'linh.nguyenhai@wellspring.edu.vn' });
    console.log('👤 User found:', user ? {
      _id: user._id,
      email: user.email,
      fullname: user.fullname,
      avatarUrl: user.avatarUrl
    } : 'No user found');

    if (user) {
      console.log('Avatar URL in DB:', user.avatarUrl);
      console.log('Avatar URL type:', typeof user.avatarUrl);
      console.log('Avatar URL length:', user.avatarUrl ? user.avatarUrl.length : 0);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkUserAvatar();
