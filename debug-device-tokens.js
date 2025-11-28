/**
 * Debug script to check device tokens in database
 * Run with: node debug-device-tokens.js
 */

const mongoose = require('mongoose');
const User = require('./models/Users');
require('dotenv').config({ path: './config.env' });

async function checkDeviceTokens() {
  try {
    console.log('🔍 Checking device tokens in database...\n');

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || process.env.DATABASE_URI || 'mongodb://localhost:27017/wellspring_tickets');
    console.log('✅ Connected to database');

    // Count total users
    const totalUsers = await User.countDocuments();
    console.log(`👥 Total users: ${totalUsers}`);

    // Count users with device tokens
    const usersWithTokens = await User.countDocuments({
      deviceToken: { $exists: true, $ne: null, $ne: '' }
    });
    console.log(`📱 Users with device tokens: ${usersWithTokens}`);

    // Get sample users with tokens
    const sampleUsers = await User.find({
      deviceToken: { $exists: true, $ne: null, $ne: '' }
    })
    .select('email fullname deviceToken')
    .limit(5)
    .lean();

    console.log('\n📋 Sample users with device tokens:');
    sampleUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.fullname} (${user.email})`);
      console.log(`   Token: ${user.deviceToken}`);

      // Validate Expo token format
      const isValidExpoToken = user.deviceToken && user.deviceToken.startsWith('ExponentPushToken[');
      console.log(`   Valid Expo format: ${isValidExpoToken ? '✅' : '❌'}`);
      console.log();
    });

    // Check support team members
    const SupportTeamMember = require('./models/SupportTeamMember');
    const supportMembers = await SupportTeamMember.find({
      isActive: true
    })
    .populate('userId', 'email fullname deviceToken')
    .select('email userId')
    .limit(10)
    .lean();

    console.log('👷 Support team members:');
    supportMembers.forEach((member, index) => {
      const user = member.userId;
      if (user) {
        console.log(`${index + 1}. ${user.fullname} (${user.email})`);
        console.log(`   Has token: ${user.deviceToken ? '✅' : '❌'}`);
        if (user.deviceToken) {
          console.log(`   Token: ${user.deviceToken}`);
        }
      } else {
        console.log(`${index + 1}. ${member.email} - No linked user account`);
      }
      console.log();
    });

    // Summary
    console.log('📊 Summary:');
    console.log(`   Total users: ${totalUsers}`);
    console.log(`   Users with tokens: ${usersWithTokens}`);
    console.log(`   Token coverage: ${((usersWithTokens / totalUsers) * 100).toFixed(1)}%`);

    if (usersWithTokens === 0) {
      console.log('\n⚠️  No device tokens found!');
      console.log('💡 This means:');
      console.log('   - Users haven\'t logged in with the mobile app yet');
      console.log('   - Mobile app failed to register push tokens');
      console.log('   - Push notification permissions denied');
      console.log('   - Expo push token generation failed');
    } else {
      console.log('\n✅ Device tokens are available!');
      console.log('💡 Push notifications should work for these users.');
    }

  } catch (error) {
    console.error('❌ Error checking device tokens:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the check
checkDeviceTokens().catch(console.error);
