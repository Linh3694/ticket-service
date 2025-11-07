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
    
    // Tối ưu: Fetch với fields cần thiết và filter enabled ngay trong API call
    const listResponse = await axios.get(
      `${FRAPPE_API_URL}/api/resource/User`,
      {
        params: {
          fields: JSON.stringify(['name', 'email', 'full_name', 'user_image', 'enabled', 'location', 'roles']),
          filters: JSON.stringify([['enabled', '=', 1]]), // Chỉ lấy enabled users
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
    console.log(`✅ Found ${userList.length} enabled users in Frappe`);
    
    // Frappe list API có thể không trả về roles (child table), cần fetch chi tiết
    // Tối ưu: Fetch parallel với batch để nhanh hơn
    const detailedUsers = [];
    const BATCH_SIZE = 10; // Fetch 10 users cùng lúc
    
    console.log(`🔍 Fetching details for ${userList.length} users (need roles)...`);
    
    // Chia thành batches và fetch parallel
    for (let i = 0; i < userList.length; i += BATCH_SIZE) {
      const batch = userList.slice(i, i + BATCH_SIZE);
      console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(userList.length / BATCH_SIZE)} (${batch.length} users)...`);
      
      // Fetch parallel cho batch này
      const batchPromises = batch.map(async (userItem) => {
        try {
          const frappe_user = await getFrappeUserDetail(userItem.name, token);
          
          // Frappe có thể gửi enabled là string "1" hoặc number 1, cần normalize
          const isEnabled = frappe_user?.enabled === 1 || frappe_user?.enabled === "1" || frappe_user?.enabled === true;
          if (frappe_user && isEnabled) {
            return frappe_user;
          }
          return null;
        } catch (err) {
          console.warn(`⚠️  Failed to fetch user ${userItem.name}: ${err.message}`);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validUsers = batchResults.filter(u => u !== null);
      detailedUsers.push(...validUsers);
      
      console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} completed: ${validUsers.length}/${batch.length} users`);
    }
    
    console.log(`✅ Fetched ${detailedUsers.length} enabled users`);
    return detailedUsers;
  } catch (error) {
    console.error('❌ Error fetching Frappe users:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return [];
  }
}

// Format Frappe user → Users model
function formatFrappeUser(frappeUser) {
  const frappe_roles = frappeUser.roles?.map(r => r.role) || [];
  // Frappe có thể gửi enabled là string "1" hoặc number 1, cần normalize
  const isEnabled = frappeUser.enabled === 1 || frappeUser.enabled === "1" || frappeUser.enabled === true;
  
  return {
    email: frappeUser.email,
    fullname: frappeUser.full_name || frappeUser.name,
    avatarUrl: frappeUser.user_image || '', // Giữ nguyên relative path /files/...
    department: frappeUser.location || '',
    provider: 'frappe',
    disabled: !isEnabled,
    active: isEnabled,
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
        
        // Log để debug avatar update
        if (frappeUser.user_image) {
          console.log(`🖼️  [Sync] Updating avatar for ${frappeUser.email}: ${userData.avatarUrl}`);
        }
        
        await User.findOneAndUpdate(
          { email: frappeUser.email },
          userData,
          { upsert: true, new: true }
        );
        synced++;
      } catch (err) {
        console.error(`❌ Failed: ${frappeUser.email}`, err.message);
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
    
    // Frappe có thể gửi enabled là string "1" hoặc number 1, cần normalize
    const isEnabled = frappeUser.enabled === 1 || frappeUser.enabled === "1" || frappeUser.enabled === true;
    if (!isEnabled) {
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
      // Frappe có thể gửi enabled là string "1" hoặc number 1, cần normalize
      const isEnabled = doc.enabled === 1 || doc.enabled === "1" || doc.enabled === true;
      if (!isEnabled) {
        console.log(`⏭️  Skipping disabled user: ${doc.name} (enabled: ${doc.enabled}, type: ${typeof doc.enabled})`);
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
