const express = require('express');
const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// 🔄 ENDPOINT 1: Auto sync all users (TEMPORARILY NO AUTH FOR TESTING)
// TODO: Add authenticate back after testing
router.post('/sync/all', userController.syncAllUsers);

// 📝 ENDPOINT 2: Manual sync all (TEMPORARILY NO AUTH FOR TESTING)
router.post('/sync/manual', userController.syncUsersManual);

// 📧 ENDPOINT 3: Sync user by email (AUTHENTICATED)
router.post('/sync/email/:email', authenticate, userController.syncUserByEmail);

// 🔔 ENDPOINT 4: Webhook - User changed in Frappe (NO AUTH)
router.post('/webhook/frappe-user-changed', userController.webhookUserChanged);

module.exports = router;
