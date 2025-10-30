const axios = require('axios');
const User = require('../models/Users');

const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';

// Redis user events handler
const handleUserRedisEvent = async (message) => {
  try {
    if (process.env.DEBUG_USER_EVENTS === '1') {
      console.log('[Ticket Service] User event received:', message?.type);
    }

    if (!message || typeof message !== 'object' || !message.type) return;

    const payload = message.user || message.data || null;

    switch (message.type) {
      case 'user_created':
      case 'user_updated':
        if (payload) {
          const updated = await User.updateFromFrappe(payload);
          console.log(`✅ [Ticket Service] User synced via Redis: ${updated.email}`);
        }
        break;
      case 'user_deleted':
        if (process.env.USER_EVENT_DELETE_ENABLED === 'true' && payload) {
          const identifier = payload?.email || message.user_id || message.name;
          if (identifier) {
            await User.deleteOne({ $or: [{ email: identifier }, { frappeUserId: identifier }] });
            console.log(`🗑️ [Ticket Service] User deleted via Redis: ${identifier}`);
          }
        }
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('[Ticket Service] Failed handling user Redis event:', err.message);
  }
};


// Export Redis event handler
module.exports.handleUserRedisEvent = handleUserRedisEvent;

// Fetch user details từ Frappe
async function getFrappeUserDetail(userEmail, token) {
  try {
    const response = await axios.get(
      `${FRAPPE_API_URL}/api/resource/User/${userEmail}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Frappe-CSRF-Token': token
        }
      }
    );
    return response.data.data;
  } catch (error) {
    console.warn(`⚠️  Failed to fetch user ${userEmail}: ${error.message}`);
    return null;
  }
}

// Fetch all users từ Frappe
async function getAllFrappeUsers(token) {
  try {
    console.log('🔍 [Sync] Fetching all Frappe users...');
    
    const listResponse = await axios.get(
      `${FRAPPE_API_URL}/api/resource/User`,
      {
        params: {
          limit_page_length: 5000,
          order_by: 'name asc'
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Frappe-CSRF-Token': token
        }
      }
    );
    
    let userList = listResponse.data.data || [];
    console.log(`✅ Found ${userList.length} users in Frappe`);
    
    // Step 2: Fetch chi tiết từng user
    console.log(`🔍 Fetching details for all users...`);
    const detailedUsers = [];
    
    for (const userItem of userList) {  // CHANGED: from slice(0, 100) to all
      try {
        const frappe_user = await getFrappeUserDetail(userItem.name, token);
        
        if (frappe_user && frappe_user.enabled === 1) {
          detailedUsers.push(frappe_user);
        }
      } catch (err) {
        console.warn(`⚠️  Failed to fetch user ${userItem.name}`);
      }
    }
    
    console.log(`✅ Fetched ${detailedUsers.length} enabled users`);
    return detailedUsers;
  } catch (error) {
    console.error('❌ Error fetching Frappe users:', error.message);
    return [];
  }
}

// Format Frappe user → Users model
function formatFrappeUser(frappeUser) {
  const frappe_roles = frappeUser.roles?.map(r => r.role) || [];
  
  return {
    email: frappeUser.email,
    fullname: frappeUser.full_name || frappeUser.name,
    avatarUrl: frappeUser.user_image || '',
    department: frappeUser.location || '',
    provider: 'frappe',
    disabled: frappeUser.enabled !== 1,
    active: frappeUser.enabled === 1,
    roles: frappe_roles,  // 🔴 Frappe system roles
    microsoftId: frappeUser.name  // Store Frappe name as reference
  };
}

// ✅ ENDPOINT 1: Auto sync all users
// TEMPORARILY COMMENTED OUT - syncAllUsers function
/*
exports.syncAllUsers = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token required for sync'
      });
    }

    console.log('🔄 [Auto Sync] Starting...');
    const frappeUsers = await getAllFrappeUsers(token);

    let synced = 0;
    let failed = 0;
    const syncedUsers = [];

    for (const frappeUser of frappeUsers) {
      try {
        const userData = formatFrappeUser(frappeUser);

        const result = await User.findOneAndUpdate(
          { email: frappeUser.email },
          userData,
          { upsert: true, new: true }
        );

        syncedUsers.push({
          email: result.email,
          fullname: result.fullname,
          roles: result.roles
        });
        synced++;
      } catch (err) {
        console.error(`❌ Failed to sync ${frappeUser.email}: ${err.message}`);
        failed++;
      }
    }

    console.log(`✅ [Auto Sync] Complete: ${synced} synced, ${failed} failed`);

    res.status(200).json({
      success: true,
      message: 'Auto sync completed',
      stats: {
        synced,
        failed,
        total: synced + failed
      },
      synced_users: syncedUsers
    });
  } catch (error) {
    console.error('❌ [Auto Sync] Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
*/

// ✅ ENDPOINT 2: Manual sync all
exports.syncUsersManual = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token required'
      });
    }
    
    console.log('📝 [Manual Sync] Starting...');
    const frappeUsers = await getAllFrappeUsers(token);
    
    let synced = 0;
    let failed = 0;
    
    for (const frappeUser of frappeUsers) {
      try {
        const userData = formatFrappeUser(frappeUser);
        
        await User.findOneAndUpdate(
          { email: frappeUser.email },
          userData,
          { upsert: true, new: true }
        );
        synced++;
      } catch (err) {
        console.error(`❌ Failed: ${frappeUser.email}`);
        failed++;
      }
    }
    
    console.log(`✅ [Manual Sync] Complete: ${synced} synced, ${failed} failed`);
    
    res.status(200).json({
      success: true,
      message: 'Manual sync completed',
      stats: { synced, failed }
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ✅ ENDPOINT 3: Sync user by email
exports.syncUserByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token required'
      });
    }
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email parameter required'
      });
    }
    
    console.log(`📧 [Sync Email] Syncing user: ${email}`);
    
    const frappeUser = await getFrappeUserDetail(email, token);
    
    if (!frappeUser) {
      return res.status(404).json({
        success: false,
        message: `User not found in Frappe: ${email}`
      });
    }
    
    if (frappeUser.enabled !== 1) {
      return res.status(400).json({
        success: false,
        message: `User is disabled in Frappe: ${email}`
      });
    }
    
    const userData = formatFrappeUser(frappeUser);
    
    const result = await User.findOneAndUpdate(
      { email: frappeUser.email },
      userData,
      { upsert: true, new: true }
    );
    
    console.log(`✅ [Sync Email] User synced: ${email}`);
    
    res.status(200).json({
      success: true,
      message: 'User synced successfully',
      user: {
        email: result.email,
        fullname: result.fullname,
        roles: result.roles,
        department: result.department,
        avatarUrl: result.avatarUrl
      }
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ✅ ENDPOINT 4: Webhook - User changed in Frappe
exports.webhookUserChanged = async (req, res) => {
  try {
    const { doc, event } = req.body;

    // Debug webhook payload
    if (process.env.DEBUG_WEBHOOK === '1') {
      console.log('🔔 [Webhook] Raw payload:', JSON.stringify(req.body, null, 2));
    }

    // Handle template strings in event (fallback)
    let actualEvent = event;
    if (typeof event === 'string' && event.includes('{{')) {
      // Try to extract event type from doc_event template
      if (event === '{{ doc_event }}') {
        actualEvent = 'update'; // Default fallback
      }
    }

    console.log(`🔔 [Webhook] User ${actualEvent}: ${doc?.name}`);

    if (!doc || !doc.name) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook payload'
      });
    }
    
    
    if (actualEvent === 'delete' || actualEvent === 'on_trash') {
      // Xoá user khỏi local DB
      console.log(`🗑️  Deleting user: ${doc.name}`);
      await User.deleteOne({ email: doc.email });
      
      return res.status(200).json({
        success: true,
        message: 'User deleted'
      });
    }
    
    if (actualEvent === 'insert' || actualEvent === 'update' || actualEvent === 'after_insert' || actualEvent === 'on_update') {
      // Chỉ sync enabled users
      if (doc.enabled !== 1) {
        console.log(`⏭️  Skipping disabled user: ${doc.name}`);
        return res.status(200).json({
          success: true,
          message: 'User is disabled, skipped'
        });
      }
      
      const frappe_roles = doc.roles?.map(r => r.role) || [];
      
      const userData = {
        email: doc.email,
        fullname: doc.full_name || doc.name,
        avatarUrl: doc.user_image || '',
        department: doc.location || '',
        provider: 'frappe',
        disabled: false,
        active: true,
        roles: frappe_roles
      };
      
      const result = await User.findOneAndUpdate(
        { email: doc.email },
        userData,
        { upsert: true, new: true }
      );
      
      console.log(`✅ [Webhook] User synced: ${doc.name} (roles: ${frappe_roles.join(', ')})`);
      
      return res.status(200).json({
        success: true,
        message: `User ${actualEvent} synced`,
        user: {
          email: result.email,
          fullname: result.fullname,
          roles: result.roles
        }
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Unknown event, ignored'
    });
  } catch (error) {
    console.error('❌ [Webhook] Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
