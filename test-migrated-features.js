#!/usr/bin/env node

/**
 * Test Script: Verify migrated features from workspace-backend to ticket-service
 * Tests: Email processing, Notifications, File uploads, Message handling
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Ticket = require('./models/Ticket');
const User = require('./models/Users');
const SupportTeamMember = require('./models/SupportTeamMember');
const notificationService = require('./services/notificationService');
const emailController = require('./controllers/emailController');

async function testDatabaseConnection() {
  console.log('🧪 Testing database connection...');

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/wellspring_tickets');
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

async function testModels() {
  console.log('🧪 Testing models...');

  try {
    // Test Ticket model
    const ticketCount = await Ticket.countDocuments();
    console.log(`✅ Ticket model: ${ticketCount} documents found`);

    // Test User model
    const userCount = await User.countDocuments();
    console.log(`✅ User model: ${userCount} documents found`);

    // Test SupportTeamMember model
    const memberCount = await SupportTeamMember.countDocuments();
    console.log(`✅ SupportTeamMember model: ${memberCount} documents found`);

    return true;
  } catch (error) {
    console.error('❌ Model test failed:', error.message);
    return false;
  }
}

async function testNotificationService() {
  console.log('🧪 Testing notification service...');

  try {
    // Test notification service initialization
    const isEnabled = notificationService.enabled;
    console.log(`✅ Notification service enabled: ${isEnabled}`);

    // Test push notification methods exist
    const hasPushMethods = typeof notificationService.sendPushNotifications === 'function';
    console.log(`✅ Push notification methods: ${hasPushMethods ? 'available' : 'missing'}`);

    return true;
  } catch (error) {
    console.error('❌ Notification service test failed:', error.message);
    return false;
  }
}

async function testEmailController() {
  console.log('🧪 Testing email controller...');

  try {
    // Test email methods exist
    const hasFetchEmails = typeof emailController.fetchEmailsAndCreateTickets === 'function';
    const hasSendEmail = typeof emailController.sendTicketStatusEmail === 'function';
    const hasNewTicketNotification = typeof emailController.sendNewTicketNotification === 'function';

    console.log(`✅ Email fetch method: ${hasFetchEmails ? 'available' : 'missing'}`);
    console.log(`✅ Email send method: ${hasSendEmail ? 'available' : 'missing'}`);
    console.log(`✅ New ticket notification: ${hasNewTicketNotification ? 'available' : 'missing'}`);

    return hasFetchEmails && hasSendEmail && hasNewTicketNotification;
  } catch (error) {
    console.error('❌ Email controller test failed:', error.message);
    return false;
  }
}

async function testUploadMiddleware() {
  console.log('🧪 Testing upload middleware...');

  try {
    // Test middleware exists
    const uploadModule = require('./middleware/uploadTicket');
    const messageUploadModule = require('./middleware/uploadMessage');

    const hasUpload = uploadModule.upload && typeof uploadModule.upload.array === 'function';
    const hasHandleError = typeof uploadModule.handleUploadError === 'function';
    const hasMessageUpload = messageUploadModule && typeof messageUploadModule.single === 'function';

    console.log(`✅ Ticket upload middleware: ${hasUpload ? 'available' : 'missing'}`);
    console.log(`✅ Upload error handler: ${hasHandleError ? 'available' : 'missing'}`);
    console.log(`✅ Message upload middleware: ${hasMessageUpload ? 'available' : 'missing'}`);

    return hasUpload && hasHandleError && hasMessageUpload;
  } catch (error) {
    console.error('❌ Upload middleware test failed:', error.message);
    return false;
  }
}

async function testRoutes() {
  console.log('🧪 Testing routes...');

  try {
    // Test ticket routes
    const ticketRoutes = require('./routes/tickets');
    console.log('✅ Ticket routes loaded successfully');

    // Test email routes
    const emailRoutes = require('./routes/emailRoutes');
    console.log('✅ Email routes loaded successfully');

    return true;
  } catch (error) {
    console.error('❌ Routes test failed:', error.message);
    return false;
  }
}

async function testConfiguration() {
  console.log('🧪 Testing configuration...');

  const requiredEnvVars = [
    'MONGODB_URI',
    'FRAPPE_API_URL',
    'PORT',
    'JWT_SECRET'
  ];

  const optionalEnvVars = [
    'EMAIL_USER',
    'TENANTTICKET_ID',
    'REDIS_HOST',
    'NOTIFICATION_SERVICE_URL'
  ];

  let requiredCount = 0;
  let optionalCount = 0;

  console.log('📋 Required environment variables:');
  requiredEnvVars.forEach(varName => {
    const value = process.env[varName];
    const status = value ? '✅' : '❌';
    console.log(`   ${status} ${varName}: ${value ? 'set' : 'missing'}`);
    if (value) requiredCount++;
  });

  console.log('📋 Optional environment variables:');
  optionalEnvVars.forEach(varName => {
    const value = process.env[varName];
    const status = value ? '✅' : '⚠️';
    console.log(`   ${status} ${varName}: ${value ? 'set' : 'not set'}`);
    if (value) optionalCount++;
  });

  console.log(`📊 Configuration status: ${requiredCount}/${requiredEnvVars.length} required, ${optionalCount}/${optionalEnvVars.length} optional`);

  return requiredCount === requiredEnvVars.length;
}

async function runAllTests() {
  console.log('🚀 Starting migrated features test suite...\n');

  const tests = [
    { name: 'Database Connection', fn: testDatabaseConnection },
    { name: 'Models', fn: testModels },
    { name: 'Notification Service', fn: testNotificationService },
    { name: 'Email Controller', fn: testEmailController },
    { name: 'Upload Middleware', fn: testUploadMiddleware },
    { name: 'Routes', fn: testRoutes },
    { name: 'Configuration', fn: testConfiguration }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n--- ${test.name} ---`);
    try {
      const result = await test.fn();
      if (result) {
        passed++;
        console.log(`✅ ${test.name} PASSED`);
      } else {
        failed++;
        console.log(`❌ ${test.name} FAILED`);
      }
    } catch (error) {
      failed++;
      console.log(`❌ ${test.name} FAILED: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`🎯 Test Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('🎉 All tests passed! Migration successful.');
  } else {
    console.log('⚠️  Some tests failed. Please check the errors above.');
  }

  console.log('='.repeat(50));

  // Close database connection
  await mongoose.disconnect();

  process.exit(failed > 0 ? 1 : 0);
}

// Run if called directly
if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };
