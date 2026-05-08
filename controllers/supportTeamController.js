const SupportTeamMember = require("../models/SupportTeamMember");
const axios = require('axios');
const mongoose = require('mongoose');

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

// Helper: Build query for finding member by email or ObjectId
function buildMemberQuery(identifier) {
  let query = {};
  
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    // If valid ObjectId, search by _id or userId field
    query = {
      $or: [
        { _id: new mongoose.Types.ObjectId(identifier) },
        { userId: new mongoose.Types.ObjectId(identifier) }
      ],
      isActive: true
    };
  } else {
    // If not ObjectId, search by email only (don't try to query ObjectId field with string)
    query = {
      email: identifier,
      isActive: true
    };
  }
  
  return query;
}

// Helper function to get user from Frappe
async function getFrappeUser(userId, token) {
  try {
    const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Frappe-CSRF-Token': token
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('Error getting user from Frappe:', error);
    return null;
  }
}

// Helper function to get all users from Frappe
async function getAllFrappeUsers(token) {
  try {
    console.log('🔍 [getAllFrappeUsers] Step 1: Fetch list of all users...');
    
    // Step 1: Lấy danh sách tất cả users (chỉ name)
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
    console.log(`✅ [getAllFrappeUsers] Step 1: Found ${userList.length} users`);
    
    // Step 2: Fetch chi tiết từng user (có enabled filter)
    console.log('🔍 [getAllFrappeUsers] Step 2: Fetching details for each user...');
    const detailedUsers = [];
    
    // Chỉ fetch chi tiết top 100 users để tránh quá chậm
    const usersToFetch = userList.slice(0, 100);
    
    for (const userItem of usersToFetch) {
      try {
        const userDetailResp = await axios.get(
          `${FRAPPE_API_URL}/api/resource/User/${userItem.name}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Frappe-CSRF-Token': token
            }
          }
        );
        
        const userData = userDetailResp.data.data;
        
        // Filter: Chỉ lấy enabled users (enabled = 1)
        if (userData.enabled === 1) {
          detailedUsers.push(userData);
        }
      } catch (err) {
        console.warn(`⚠️  Failed to fetch user details for ${userItem.name}: ${err.message}`);
        // Continue với user tiếp theo
      }
    }
    
    console.log(`✅ [getAllFrappeUsers] Step 2: Fetched ${detailedUsers.length} enabled users (out of ${usersToFetch.length} checked)`);
    
    console.log(`✅ [getAllFrappeUsers] Step 3: Using all ${detailedUsers.length} enabled users`);
    
    if (detailedUsers.length > 0) {
      console.log('📝 [getAllFrappeUsers] Sample user:', JSON.stringify(detailedUsers[0], null, 2));
    }
    
    return detailedUsers;
  } catch (error) {
    console.error('❌ [getAllFrappeUsers] Error:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
    return [];
  }
}

// Lấy tất cả team members
exports.getAllTeamMembers = async (req, res) => {
  try {
    const { role, search } = req.query;
    
    console.log('🔍 [getAllTeamMembers] Starting query...');
    console.log('   Query params - role:', role, 'search:', search);
    
    let filters = {};
    
    // Filter by role if specified
    if (role) {
      filters.roles = role;
    }
    
    console.log('📋 [getAllTeamMembers] Filters:', JSON.stringify(filters));
    
    // Use getAllMembers static method (auto-populates user data)
    let members = await SupportTeamMember.getAllMembers(filters);
    
    console.log(`✅ [getAllTeamMembers] Found ${members.length} members from DB`);
    console.log(`📝 [getAllTeamMembers] Member sample:`, members[0] ? JSON.stringify(members[0], null, 2) : 'NONE');
    
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      members = members.filter(member => 
        (member.fullname && member.fullname.toLowerCase().includes(searchLower)) ||
        (member.email && member.email.toLowerCase().includes(searchLower))
      );
      console.log(`🔎 [getAllTeamMembers] After search filter: ${members.length} members`);
    }
    
    console.log(`📤 [getAllTeamMembers] Returning ${members.length} members to FE`);
    
    res.status(200).json({ 
      success: true,
      data: {
        members,
        total: members.length
      }
    });
  } catch (error) {
    console.error('❌ Error getting team members:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Lấy team member theo ID
exports.getTeamMemberById = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const member = await SupportTeamMember.getMemberByUserId(userId);
    
    if (!member) {
      return res.status(404).json({ 
        success: false, 
        message: 'Team member not found' 
      });
    }
    
    res.status(200).json({ 
      success: true,
      data: { member }
    });
  } catch (error) {
    console.error('Error getting team member:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Lấy danh sách users từ Frappe
exports.getFrappeUsers = async (req, res) => {
  try {
    const User = require('../models/Users');
    
    // Users đã được synced từ Frappe via webhooks hoặc manual sync
    console.log('🔍 [getFrappeUsers] Querying users from MongoDB...');
    
    const users = await User.find({ 
      active: true, 
      disabled: false 
    })
      .sort({ fullname: 1 })
      .limit(500)
      .lean();  // Lean mode để performance tốt hơn
    
    console.log(`✅ [getFrappeUsers] Found ${users.length} active users from MongoDB`);
    
    // Format users cho FE
    const formattedUsers = users.map(user => ({
      userId: user.email,  // Use email as unique identifier
      fullname: user.fullname,
      email: user.email,
      username: user.username || '',
      avatarUrl: user.avatarUrl || '',
      department: user.department || '',
      roles: user.roles || [],  // Include Frappe roles for reference
      employeeCode: user.employeeCode || '',
    }));
    
    console.log(`📤 [getFrappeUsers] Returning ${formattedUsers.length} formatted users`);
    
    res.status(200).json({ 
      success: true,
      data: { users: formattedUsers }
    });
  } catch (error) {
    console.error('❌ Error getting users from MongoDB:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// DEBUG: Xem raw response từ Frappe
exports.debugFrappeUsers = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token required for debug endpoint',
        hint: 'Add Authorization: Bearer YOUR_TOKEN header'
      });
    }
    
    console.log('🔍 [debugFrappeUsers] Testing multiple ways to fetch User fields...');
    
    // Test 1: With fields as JSON string
    console.log('\n📌 Test 1: fields=JSON.stringify([...])');
    try {
      const resp1 = await axios.get(
        `${FRAPPE_API_URL}/api/resource/User`,
        {
          params: {
            fields: JSON.stringify(['name', 'full_name', 'email', 'first_name', 'last_name']),
            limit_page_length: 1
          },
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Frappe-CSRF-Token': token
          }
        }
      );
      console.log('✅ Test 1 success. Fields returned:', Object.keys(resp1.data.data?.[0] || {}));
    } catch (e) {
      console.log('❌ Test 1 failed:', e.message);
    }

    // Test 2: With fields as comma-separated string
    console.log('\n📌 Test 2: fields="name,full_name,email,first_name,last_name"');
    try {
      const resp2 = await axios.get(
        `${FRAPPE_API_URL}/api/resource/User`,
        {
          params: {
            fields: 'name,full_name,email,first_name,last_name',
            limit_page_length: 1
          },
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Frappe-CSRF-Token': token
          }
        }
      );
      console.log('✅ Test 2 success. Fields returned:', Object.keys(resp2.data.data?.[0] || {}));
    } catch (e) {
      console.log('❌ Test 2 failed:', e.message);
    }

    // Test 3: Without fields parameter (get all fields)
    console.log('\n📌 Test 3: No fields param (get all available fields)');
    try {
      const resp3 = await axios.get(
        `${FRAPPE_API_URL}/api/resource/User`,
        {
          params: {
            limit_page_length: 1
          },
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Frappe-CSRF-Token': token
          }
        }
      );
      console.log('✅ Test 3 success. Fields returned:', Object.keys(resp3.data.data?.[0] || {}));
      console.log('📋 Sample user:', JSON.stringify(resp3.data.data?.[0], null, 2));
    } catch (e) {
      console.log('❌ Test 3 failed:', e.message);
    }

    // Test 4: Fetch single user by ID to see all available fields
    console.log('\n📌 Test 4: Fetch single user by ID');
    try {
      // Lấy tên user đầu tiên
      const listResp = await axios.get(
        `${FRAPPE_API_URL}/api/resource/User`,
        {
          params: { limit_page_length: 1 },
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Frappe-CSRF-Token': token
          }
        }
      );
      const userId = listResp.data.data?.[0]?.name;
      
      if (userId) {
        const resp4 = await axios.get(
          `${FRAPPE_API_URL}/api/resource/User/${userId}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Frappe-CSRF-Token': token
            }
          }
        );
        console.log(`✅ Test 4 success for user ${userId}`);
        console.log('📋 User fields:', Object.keys(resp4.data.data || {}));
        console.log('📋 Full user object:', JSON.stringify(resp4.data.data, null, 2));
      }
    } catch (e) {
      console.log('❌ Test 4 failed:', e.message);
    }
    
    res.status(200).json({
      success: true,
      message: 'Check backend console logs for test results',
      hint: 'Look at ticket-service logs to see which test passed'
    });
  } catch (error) {
    console.error('❌ [debugFrappeUsers] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Tạo hoặc cập nhật team member
exports.createOrUpdateTeamMember = async (req, res) => {
  try {
    const { email, roles, notes } = req.body;
    
    // Validate required fields
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'email is required' 
      });
    }
    
    // Validate roles
    if (roles && roles.length > 0) {
      const validRoles = SupportTeamMember.SUPPORT_ROLES;
      const invalidRoles = roles.filter(role => !validRoles.includes(role));
      if (invalidRoles.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: `Invalid roles: ${invalidRoles.join(', ')}. Valid roles: ${validRoles.join(', ')}` 
        });
      }
    }
    
    // createOrUpdate sẽ auto-populate fullname, avatarUrl, department từ Users collection
    const member = await SupportTeamMember.createOrUpdate({
      email,
      roles: roles || [],
      notes
    });
    
    res.status(200).json({ 
      success: true,
      data: { member },
      message: 'Team member saved successfully'
    });
  } catch (error) {
    console.error('Error creating/updating team member:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Cập nhật roles của member
exports.updateTeamMemberRoles = async (req, res) => {
  try {
    const { userId } = req.params;
    const { roles } = req.body;
    
    if (!roles || !Array.isArray(roles)) {
      return res.status(400).json({ 
        success: false, 
        message: 'roles must be an array' 
      });
    }
    
    // Validate roles
    const validRoles = SupportTeamMember.SUPPORT_ROLES;
    const invalidRoles = roles.filter(role => !validRoles.includes(role));
    if (invalidRoles.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Invalid roles: ${invalidRoles.join(', ')}. Valid roles: ${validRoles.join(', ')}` 
      });
    }
    
    // Find member document (not populated, để có thể save)
    const memberDoc = await SupportTeamMember.findOne(buildMemberQuery(userId));
    
    if (!memberDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Team member not found' 
      });
    }
    
    memberDoc.roles = roles;
    await memberDoc.save();
    
    // Populate data để return
    const populatedMember = await SupportTeamMember.populateUserData([memberDoc]);
    
    res.status(200).json({ 
      success: true,
      data: { member: populatedMember[0] },
      message: 'Roles updated successfully'
    });
  } catch (error) {
    console.error('Error updating member roles:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Xóa team member (soft delete)
exports.deleteTeamMember = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const message = await SupportTeamMember.removeMember(userId);
    
    res.status(200).json({ 
      success: true,
      data: null,
      message 
    });
  } catch (error) {
    console.error('Error deleting team member:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ⚠️ NOTE: User webhooks đã move sang controllers/userController.js
// - webhookUserChanged() → /api/ticket/user/webhook/frappe-user-changed
// - syncUsersFromFrappe() → /api/ticket/user/sync/all
// - webhookTest() → removed (use /api/ticket/user/webhook/frappe-user-changed instead)

// Lấy danh sách available roles
exports.getAvailableRoles = async (req, res) => {
  try {
    const roles = SupportTeamMember.SUPPORT_ROLES;
    
    const rolesWithLabels = roles.map(role => {
      const labelMap = {
        'Overall': 'Vấn đề chung',
        'Account': 'Tài khoản',
        'Camera System': 'Hệ thống Camera',
        'Network System': 'Hệ thống mạng',
        'Bell System': 'Hệ thống chuông báo',
        'Software': 'Phần mềm',
        'Email Ticket': 'Xử lý ticket từ email'
      };

      return {
        value: role,
        label: labelMap[role] || role
      };
    });
    
    res.status(200).json({ 
      success: true,
      data: { roles: rolesWithLabels }
    });
  } catch (error) {
    console.error('Error getting available roles:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Lấy members theo role (để auto-assign ticket)
exports.getMembersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    
    const members = await SupportTeamMember.getMembersByRole(role);
    
    res.status(200).json({ 
      success: true,
      data: {
        members,
        total: members.length
      }
    });
  } catch (error) {
    console.error('Error getting members by role:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Cập nhật stats của member
exports.updateMemberStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const { totalTickets, resolvedTickets, averageRating } = req.body;
    
    // Find member document (not populated, để có thể save)
    const memberDoc = await SupportTeamMember.findOne(buildMemberQuery(userId));
    
    if (!memberDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Team member not found' 
      });
    }
    
    await memberDoc.updateStats({
      totalTickets,
      resolvedTickets,
      averageRating
    });
    
    // Populate data để return
    const populatedMember = await SupportTeamMember.populateUserData([memberDoc]);
    
    res.status(200).json({ 
      success: true,
      data: { member: populatedMember[0] },
      message: 'Stats updated successfully'
    });
  } catch (error) {
    console.error('Error updating member stats:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

