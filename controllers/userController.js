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

// Fetch enabled users từ Frappe (chỉ lấy users đang active)
async function getAllFrappeUsers(token) {
  try {
    console.log('🔍 [Sync] Fetching enabled Frappe users only...');

    // Paginate để lấy TẤT CẢ enabled users
    // Thêm filter enabled=1 để chỉ lấy users đang active
    const allUsers = [];
    let start = 0;
    const pageLength = 20; // Frappe có thể giới hạn mặc định là 20
    let hasMore = true;
    const maxPages = 50; // Safety limit: max 50 pages (~1000 users) để tránh infinite loop
    let pageCount = 0;

    while (hasMore && pageCount < maxPages) {
      const listResponse = await axios.get(
        `${FRAPPE_API_URL}/api/resource/User`,
        {
          params: {
            fields: JSON.stringify([
              'name', 'email', 'full_name', 'first_name', 'middle_name', 'last_name',
              'user_image', 'enabled', 'disabled', 'location', 'department',
              'job_title', 'designation', 'employee_code', 'microsoft_id',
              'roles', 'docstatus', 'user_type'
            ]),
            // Thử filter enabled users từ API (nếu API hỗ trợ)
            filters: JSON.stringify([["User", "enabled", "=", 1]]),
            limit_start: start,
            limit_page_length: pageLength,
            order_by: 'name asc'
          },
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Frappe-CSRF-Token': token
          }
        }
      );

      pageCount++;
      const userList = listResponse.data.data || [];
      const totalCount = listResponse.data.total_count || listResponse.data.total;

      console.log(`📦 Page ${pageCount}: Found ${userList.length} users (limit_start: ${start}, limit_page_length: ${pageLength})`);
      
      // Debug: Log API response structure (chỉ log page đầu tiên)
      if (pageCount === 1) {
        console.log(`🔍 [Debug] API Response structure:`);
        console.log(`   - Has data array: ${!!listResponse.data.data}`);
        console.log(`   - Data length: ${userList.length}`);
        console.log(`   - Total count: ${totalCount || 'N/A'}`);
        if (userList.length > 0) {
          const firstUser = userList[0];
          console.log(`   - First user keys: ${Object.keys(firstUser).join(', ')}`);
        }
      }

      // Debug: Check enabled field values in first few users
      if (pageCount <= 3 && userList.length > 0) { // Debug first 3 pages
        console.log(`🔍 [Debug] Page ${pageCount} users:`);
        userList.slice(0, 3).forEach((user, idx) => {
          console.log(`   User ${idx + 1}: email=${user.email}, enabled=${user.enabled} (type: ${typeof user.enabled}), docstatus=${user.docstatus}`);
        });
      }

      if (totalCount) {
        console.log(`   📊 Reported total_count: ${totalCount}`);
      }

      if (userList.length === 0) {
        console.log(`✅ No more users found, stopping pagination`);
        hasMore = false;
      } else {
        // Filter enabled users only (flexible logic)
        // Priority: enabled field > disabled field > docstatus
        const enabledUsers = userList.filter(user => {
          // Check disabled field first (nếu disabled = true thì chắc chắn không enabled)
          if (user.disabled === true || user.disabled === 1 || user.disabled === "1") {
            return false;
          }
          
          // Check enabled field (ưu tiên cao nhất)
          if (user.enabled !== undefined && user.enabled !== null) {
            const isEnabled = user.enabled === 1 || user.enabled === true || user.enabled === "1";
            return isEnabled;
          }
          
          // Fallback: check docstatus (0 = active/draft, 1 = submitted, 2 = cancelled)
          if (user.docstatus !== undefined && user.docstatus !== null) {
            return user.docstatus === 0; // Only active/draft users
          }
          
          // Nếu không có thông tin nào về status, mặc định là enabled (tránh filter quá strict)
          // Điều này có thể xảy ra nếu API không trả về các field này
          return true;
        });

        console.log(`   ✅ Filtered ${enabledUsers.length} enabled users from ${userList.length} total users`);
        
        // Debug: Log why users were filtered out (chỉ log page đầu tiên)
        if (pageCount === 1 && enabledUsers.length < userList.length) {
          const filteredOut = userList.filter(u => !enabledUsers.includes(u));
          console.log(`   ⚠️  Filtered out ${filteredOut.length} users:`);
          filteredOut.slice(0, 5).forEach(u => {
            console.log(`      - ${u.email}: enabled=${u.enabled}, disabled=${u.disabled}, docstatus=${u.docstatus}`);
          });
        }
        
        // Debug: Log sample of enabled users (chỉ log page đầu tiên)
        if (pageCount === 1 && enabledUsers.length > 0) {
          console.log(`   ✅ Sample enabled users:`);
          enabledUsers.slice(0, 3).forEach(u => {
            console.log(`      - ${u.email}: enabled=${u.enabled}, disabled=${u.disabled}, docstatus=${u.docstatus}`);
          });
        }

        allUsers.push(...enabledUsers);

        // Safety check: stop if we hit max pages
        if (pageCount >= maxPages) {
          console.log(`⚠️  Reached max pages limit (${maxPages}), stopping to prevent infinite loop`);
          console.log(`   📊 Collected ${allUsers.length} enabled users so far`);
          hasMore = false;
        }
        // KHÔNG tin vào total_count - tiếp tục paginate cho đến khi không còn data
        else if (userList.length < pageLength) {
          // Nếu số users trả về ít hơn pageLength, đã hết data
          console.log(`✅ Last page reached (returned ${userList.length} < ${pageLength})`);
          hasMore = false;
        } else {
          // Tiếp tục fetch page tiếp theo (bỏ qua total_count vì có thể không chính xác)
          start += pageLength;
          console.log(`   ➡️  Continuing to next page (start: ${start})`);
        }
      }
    }

    console.log(`✅ Found total ${allUsers.length} enabled users in Frappe`);

    // Tối ưu: Sử dụng data từ list API luôn (đã có đủ fields cần thiết)
    // Roles sẽ được update sau qua webhook hoặc khi user login
    // Nếu list API không có roles, sẽ là empty array và sẽ được update sau
    const detailedUsers = allUsers.map(user => {
      // Normalize roles từ list API (có thể là string array hoặc object array)
      const normalizedRoles = Array.isArray(user.roles)
        ? user.roles.map((r) => (typeof r === 'string' ? r : r?.role)).filter(Boolean)
        : [];

      // Trong Frappe, User.name thường là email, nếu email field không có thì dùng name
      const userEmail = user.email || user.name || '';
      
      // Đảm bảo có đủ fields cần thiết cho formatFrappeUser
      return {
        name: user.name,
        email: userEmail, // Dùng name làm fallback nếu email không có
        full_name: user.full_name || user.name,
        first_name: user.first_name,
        middle_name: user.middle_name,
        last_name: user.last_name,
        user_image: user.user_image || '',
        enabled: user.enabled,
        disabled: user.disabled,
        location: user.location || '',
        department: user.department, // Include department nếu có
        job_title: user.job_title,
        designation: user.designation,
        employee_code: user.employee_code,
        employeeCode: user.employeeCode,
        microsoft_id: user.microsoft_id,
        microsoftId: user.microsoftId,
        docstatus: user.docstatus, // Quan trọng: cần để formatFrappeUser xác định enabled status
        roles: normalizedRoles, // Normalized roles
        roles_list: user.roles_list || normalizedRoles // Fallback
      };
    });

    console.log(`✅ Using ${detailedUsers.length} enabled users from list API (roles normalized, will be updated via webhook if needed)`);
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
  // Normalize roles: hỗ trợ cả string array và object array
  const roles = Array.isArray(frappeUser.roles)
    ? frappeUser.roles.map((r) => (typeof r === 'string' ? r : r?.role)).filter(Boolean)
    : Array.isArray(frappeUser.roles_list)
    ? frappeUser.roles_list
    : [];

  // Xác định enabled status: ưu tiên docstatus, fallback về enabled/disabled fields
  // In Frappe, users with docstatus = 0 are considered enabled (active)
  const isEnabled = frappeUser.docstatus === 0 || 
    (frappeUser.docstatus === undefined && frappeUser.enabled !== false && frappeUser.disabled !== true);

  // Normalize fullname với nhiều fallback options
  const fullName = frappeUser.full_name || frappeUser.fullname || frappeUser.fullName ||
    [frappeUser.first_name, frappeUser.middle_name, frappeUser.last_name].filter(Boolean).join(' ') ||
    frappeUser.name;

  // Trong Frappe, User.name thường là email, nếu email field không có thì dùng name
  const userEmail = frappeUser.email || frappeUser.name || '';

  return {
    email: userEmail,
    fullname: fullName,
    avatarUrl: frappeUser.user_image || frappeUser.userImage || frappeUser.avatar || frappeUser.avatar_url || '',
    department: frappeUser.department || frappeUser.location || 'Unknown',
    jobTitle: frappeUser.job_title || frappeUser.designation || 'User',
    provider: 'frappe',
    disabled: !isEnabled,
    active: isEnabled,
    roles: roles,  // Frappe system roles (normalized)
    role: roles.length > 0 ? roles[0].toLowerCase() : 'user', // Legacy single role
    microsoftId: frappeUser.microsoft_id || frappeUser.microsoftId || frappeUser.name, // Store Frappe name as reference
    employeeCode: frappeUser.employee_code || frappeUser.employeeCode || undefined
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

// ✅ ENDPOINT 2: Manual sync all enabled users (batch processing)
exports.syncUsersManual = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token required'
      });
    }

    console.log('📝 [Manual Sync] Starting batch sync for enabled users only...');
    const startTime = Date.now();

    const frappeUsers = await getAllFrappeUsers(token);
    console.log(`📊 [Manual Sync] Found ${frappeUsers.length} enabled users to sync`);

    if (frappeUsers.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No enabled users to sync',
        stats: { synced: 0, failed: 0, total: 0 }
      });
    }

    let synced = 0;
    let failed = 0;
    const failedUsers = []; // Track failed users for debugging
    const batchSize = 10; // Process 10 users at a time
    const batches = [];
    let avatarDebugCount = 0; // Counter để chỉ log một vài avatars đầu tiên

    // Filter out users without email before processing
    // Trong Frappe, User.name thường là email, nên cần check cả name nếu email không có
    const validUsers = frappeUsers.filter(user => {
      const userEmail = user.email || user.name || '';
      if (!userEmail || !userEmail.includes('@')) {
        console.warn(`⚠️  [Manual Sync] Skipping user without valid email: ${user.name || 'Unknown'}`);
        failed++;
        failedUsers.push({ identifier: user.name || 'Unknown', error: 'Missing email' });
        return false;
      }
      return true;
    });

    console.log(`✅ [Manual Sync] ${validUsers.length} valid users (${frappeUsers.length - validUsers.length} skipped due to missing email)`);

    // Chia thành các batch
    for (let i = 0; i < validUsers.length; i += batchSize) {
      batches.push(validUsers.slice(i, i + batchSize));
    }

    console.log(`🔄 [Manual Sync] Processing ${batches.length} batches of ${batchSize} users each...`);

    // Process từng batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchStartTime = Date.now();

      console.log(`📦 [Manual Sync] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} users)...`);

      // Process batch parallel với Promise.allSettled
      const batchPromises = batch.map(async (frappeUser) => {
        try {
          // Validate email: trong Frappe, name thường là email
          const userEmail = frappeUser.email || frappeUser.name || '';
          if (!userEmail || !userEmail.includes('@')) {
            throw new Error('Email is required and must be valid');
          }

          const userData = formatFrappeUser(frappeUser);

          // Validate formatted user data
          if (!userData.email || !userData.fullname) {
            throw new Error(`Invalid user data: missing email or fullname`);
          }

          // Log để debug avatar update (chỉ log 5 users đầu tiên có avatar)
          if (frappeUser.user_image && avatarDebugCount < 5) {
            avatarDebugCount++;
            const existingUser = await User.findOne({ email: userEmail }).select('avatarUrl');
            const oldAvatar = existingUser?.avatarUrl || '';
            const newAvatar = userData.avatarUrl || '';
            if (oldAvatar !== newAvatar) {
              console.log(`🖼️  [Sync] Avatar changed for ${userEmail}: "${oldAvatar}" → "${newAvatar}"`);
            } else if (newAvatar) {
              console.log(`🖼️  [Sync] Avatar unchanged for ${userEmail}: "${newAvatar}"`);
            }
          }

          // Sử dụng $set để đảm bảo tất cả fields được update, kể cả avatarUrl
          // Điều này đảm bảo avatarUrl luôn được cập nhật ngay cả khi giá trị không thay đổi
          const result = await User.findOneAndUpdate(
            { email: userEmail },
            { $set: userData },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          return { success: true, email: userEmail, roles: result.roles || [] };
        } catch (err) {
          console.error(`❌ [Manual Sync] Failed to sync ${frappeUser.email || frappeUser.name || 'Unknown'}: ${err.message}`);
          return { success: false, email: frappeUser.email || frappeUser.name || 'Unknown', error: err.message };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Count results và collect failed users
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            synced++;
          } else {
            failed++;
            failedUsers.push({
              email: result.value.email,
              error: result.value.error
            });
          }
        } else {
          // Promise rejected
          failed++;
          failedUsers.push({
            email: 'Unknown',
            error: result.reason?.message || 'Unknown error'
          });
        }
      });

      const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2);
      console.log(`✅ [Manual Sync] Batch ${batchIndex + 1} completed in ${batchDuration}s (${synced} synced, ${failed} failed so far)`);

      // Progress logging mỗi 50 users
      const totalProcessed = synced + failed;
      if (totalProcessed % 50 === 0 || batchIndex === batches.length - 1) {
        const progress = ((totalProcessed / validUsers.length) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`📊 [Manual Sync] Progress: ${totalProcessed}/${validUsers.length} users (${progress}%) in ${elapsed}s`);
      }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [Manual Sync] Complete: ${synced} synced, ${failed} failed in ${totalDuration}s`);

    const response = {
      success: true,
      message: `Manual sync completed for ${frappeUsers.length} enabled users`,
      stats: { 
        synced, 
        failed, 
        total: frappeUsers.length,
        valid_users: validUsers.length,
        skipped: frappeUsers.length - validUsers.length
      },
      duration_seconds: parseFloat(totalDuration)
    };

    // Include failed users in response if any (for debugging)
    if (failedUsers.length > 0 && failedUsers.length <= 20) {
      response.failed_users = failedUsers.slice(0, 20); // Limit to first 20 failed users
    } else if (failedUsers.length > 20) {
      response.failed_users_count = failedUsers.length;
      response.failed_users_sample = failedUsers.slice(0, 10); // Show sample of 10
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ [Manual Sync] Error:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    res.status(500).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ✅ ENDPOINT DEBUG: Test fetch first page of users
exports.debugFetchUsers = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token required'
      });
    }

    console.log('🔍 [Debug] Testing Frappe user fetch...');

    const listResponse = await axios.get(
      `${FRAPPE_API_URL}/api/resource/User`,
      {
        params: {
          fields: JSON.stringify(['name', 'email', 'full_name', 'user_image', 'enabled', 'location', 'roles', 'docstatus', 'disabled', 'user_type', 'last_login', 'creation', 'modified']),
          limit_start: 0,
          limit_page_length: 10, // Only first 10 users
          order_by: 'name asc'
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Frappe-CSRF-Token': token
        }
      }
    );

    const userList = listResponse.data.data || [];
    const totalCount = listResponse.data.total_count || listResponse.data.total;

    console.log(`📦 Found ${userList.length} users (total_count: ${totalCount})`);

    // Analyze user fields
    const fieldStats = {
      total: userList.length,
      // enabled field
      enabled_true: userList.filter(u => u.enabled === true).length,
      enabled_1_number: userList.filter(u => u.enabled === 1).length,
      enabled_1_string: userList.filter(u => u.enabled === "1").length,
      enabled_0: userList.filter(u => u.enabled === 0 || u.enabled === "0" || u.enabled === false).length,
      enabled_null: userList.filter(u => u.enabled === null || u.enabled === undefined).length,
      // disabled field (might be the opposite)
      disabled_true: userList.filter(u => u.disabled === true).length,
      disabled_1_number: userList.filter(u => u.disabled === 1).length,
      disabled_1_string: userList.filter(u => u.disabled === "1").length,
      disabled_0: userList.filter(u => u.disabled === 0 || u.disabled === "0" || u.disabled === false).length,
      disabled_null: userList.filter(u => u.disabled === null || u.disabled === undefined).length,
      // docstatus (most reliable indicator)
      docstatus_0: userList.filter(u => u.docstatus === 0).length,  // Active users
      docstatus_1: userList.filter(u => u.docstatus === 1).length,  // Submitted
      docstatus_2: userList.filter(u => u.docstatus === 2).length,  // Cancelled
      docstatus_null: userList.filter(u => u.docstatus === null || u.docstatus === undefined).length,
      // user_type
      user_type_null: userList.filter(u => !u.user_type).length,
      user_type_system: userList.filter(u => u.user_type === 'System User').length,
      user_type_website: userList.filter(u => u.user_type === 'Website User').length,
      user_type_other: userList.filter(u => u.user_type && u.user_type !== 'System User' && u.user_type !== 'Website User').length
    };

    console.log('📊 Field analysis:', fieldStats);

    const sampleUsers = userList.slice(0, 5).map(user => ({
      email: user.email,
      name: user.name,
      enabled: user.enabled,
      disabled: user.disabled,
      docstatus: user.docstatus,  // This is the key field for active users
      user_type: user.user_type,
      full_name: user.full_name,
      creation: user.creation,
      modified: user.modified
    }));

    res.status(200).json({
      success: true,
      message: 'Debug fetch completed',
      stats: fieldStats,
      sample_users: sampleUsers,
      total_count: totalCount
    });
  } catch (error) {
    console.error('❌ [Debug] Error:', error.message);
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
    
    // In Frappe, users with docstatus = 0 are considered enabled (active)
    const isEnabled = frappeUser.docstatus === 0;
    if (!isEnabled) {
      return res.status(400).json({
        success: false,
        message: `User is not active in Frappe: ${email}`
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
      // Chỉ sync enabled users (active users)
      // In Frappe, users with docstatus = 0 are considered enabled (active)
      const isEnabled = doc.docstatus === 0;
      if (!isEnabled) {
        console.log(`⏭️  Skipping inactive user: ${doc.name} (docstatus: ${doc.docstatus})`);
        return res.status(200).json({
          success: true,
          message: 'User is not active, skipped'
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
