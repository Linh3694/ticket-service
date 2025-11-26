const express = require('express');
const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// 🔄 ENDPOINT 1: Auto sync all users (AUTHENTICATED) - TEMPORARILY DISABLED
// router.post('/sync/all', authenticate, userController.syncAllUsers);

// 📝 ENDPOINT 2: Manual sync all (AUTHENTICATED)
router.post('/sync/manual', authenticate, userController.syncUsersManual);

// 🔍 ENDPOINT DEBUG: Test fetch users (AUTHENTICATED)
router.get('/debug/fetch-users', authenticate, userController.debugFetchUsers);

// 📧 ENDPOINT 3: Sync user by email (AUTHENTICATED)
router.post('/sync/email/:email', authenticate, userController.syncUserByEmail);

// 🔔 ENDPOINT 4: Webhook - User changed in Frappe (NO AUTH)
router.post('/webhook/frappe-user-changed', userController.webhookUserChanged);

// 👤 ENDPOINT 5: Create user from email (NO AUTH - for email service)
router.post('/', userController.createUserFromEmail);

// 👤 ENDPOINT 6: Get user by email (NO AUTH - for email service)
router.get('/email/:email', userController.getUserByEmail);

// 👤 ENDPOINT 7: Get user by email for internal use (NO AUTH)
router.get('/by-email/:email', userController.getUserByEmail);

module.exports = router;
