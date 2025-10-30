#!/usr/bin/env node

/**
 * Test script để verify Redis user events hoạt động
 * Chạy: node scripts/test-redis-events.js
 */

require('dotenv').config({ path: './config.env' });
const redis = require('../config/redis');
const { syncUserFromPayload } = require('../controllers/userController');

async function testRedisUserEvents() {
  console.log('🧪 [Test] Testing Redis User Events...');

  try {
    // Test 1: Publish user event
    console.log('\n📤 Test 1: Publishing user event...');
    const testUser = {
      email: 'test.user@wellspring.edu.vn',
      full_name: 'Test User',
      department: 'IT Department',
      roles: ['System Manager', 'User'],
      enabled: true,
      user_image: '',
      provider: 'frappe'
    };

    const message = {
      type: 'user_created',
      user: testUser,
      source: 'test_script',
      timestamp: new Date().toISOString()
    };

    await redis.publish(process.env.REDIS_USER_CHANNEL || 'user_events', message);
    console.log('✅ Published user event');

    // Test 2: Wait for subscription to process
    console.log('\n⏳ Test 2: Waiting for event processing...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: Verify user was synced
    console.log('\n🔍 Test 3: Verifying user sync...');
    const User = require('../models/Users');
    const syncedUser = await User.findOne({ email: testUser.email });

    if (syncedUser) {
      console.log('✅ User synced successfully:', {
        email: syncedUser.email,
        fullname: syncedUser.fullname,
        roles: syncedUser.roles,
        active: syncedUser.active
      });
    } else {
      console.log('❌ User not found in database');
    }

    // Test 4: Test update event
    console.log('\n📤 Test 4: Testing update event...');
    const updateMessage = {
      type: 'user_updated',
      user: { ...testUser, department: 'HR Department' },
      source: 'test_script',
      timestamp: new Date().toISOString()
    };

    await redis.publish(process.env.REDIS_USER_CHANNEL || 'user_events', updateMessage);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const updatedUser = await User.findOne({ email: testUser.email });
    if (updatedUser && updatedUser.department === 'HR Department') {
      console.log('✅ User update processed successfully');
    } else {
      console.log('❌ User update failed');
    }

    console.log('\n🎉 [Test] Redis User Events test completed!');

  } catch (error) {
    console.error('❌ [Test] Error:', error.message);
    process.exit(1);
  }
}

// Run test
testRedisUserEvents().then(() => {
  console.log('\n🏁 Test script finished');
  process.exit(0);
}).catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
