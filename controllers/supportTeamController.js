const SupportTeamMember = require("../models/SupportTeamMember");
const axios = require('axios');

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

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
    const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User?fields=["name","full_name","email","user_image","department"]&limit_page_length=999`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Frappe-CSRF-Token': token
      }
    });
    return response.data.data || [];
  } catch (error) {
    console.error('Error getting users from Frappe:', error);
    return [];
  }
}

// Lấy tất cả team members
exports.getAllTeamMembers = async (req, res) => {
  try {
    const { role, search } = req.query;
    
    let query = { isActive: true };
    
    // Filter by role if specified
    if (role) {
      query.roles = role;
    }
    
    let members = await SupportTeamMember.find(query).sort({ fullname: 1 });
    
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      members = members.filter(member => 
        member.fullname.toLowerCase().includes(searchLower) ||
        member.email.toLowerCase().includes(searchLower) ||
        member.userId.toLowerCase().includes(searchLower)
      );
    }
    
    res.status(200).json({ 
      success: true,
      data: {
        members,
        total: members.length
      }
    });
  } catch (error) {
    console.error('Error getting team members:', error);
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
    // 🔓 PUBLIC endpoint - không yêu cầu authentication
    // Nhưng vẫn cố lấy token từ request để call Frappe API nếu có
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    // ⚠️ Nếu không có token, vẫn cố gọi Frappe API với default header
    // hoặc fallback method khác
    let users = [];
    
    if (token) {
      // Có token - gọi Frappe API như bình thường
      users = await getAllFrappeUsers(token);
    } else {
      // Không có token - vẫn cố gọi với API token nếu config có
      console.log('⚠️ [getFrappeUsers] No auth token provided, using default headers');
      
      // Fallback: sử dụng API key nếu có trong env
      try {
        const response = await axios.get(
          `${FRAPPE_API_URL}/api/resource/User?fields=["name","full_name","email","user_image","department"]&limit_page_length=999`,
          {
            headers: {
              'Authorization': process.env.FRAPPE_API_KEY && process.env.FRAPPE_API_SECRET 
                ? `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`
                : '',
              'Content-Type': 'application/json'
            }
          }
        );
        users = response.data.data || [];
      } catch (fallbackErr) {
        console.error('❌ Fallback API call failed:', fallbackErr.message);
        users = [];
      }
    }
    
    // Format users
    const formattedUsers = users.map(user => ({
      userId: user.name,
      fullname: user.full_name || user.name,
      email: user.email,
      avatarUrl: user.user_image || '',
      department: user.department || ''
    }));
    
    res.status(200).json({ 
      success: true,
      data: { users: formattedUsers }
    });
  } catch (error) {
    console.error('Error getting Frappe users:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Tạo hoặc cập nhật team member
exports.createOrUpdateTeamMember = async (req, res) => {
  try {
    const { userId, fullname, email, avatarUrl, department, roles, notes } = req.body;
    
    // Validate required fields
    if (!userId || !fullname || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'userId, fullname, and email are required' 
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
    
    const member = await SupportTeamMember.createOrUpdate({
      userId,
      fullname,
      email,
      avatarUrl,
      department,
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
    
    const member = await SupportTeamMember.getMemberByUserId(userId);
    
    if (!member) {
      return res.status(404).json({ 
        success: false, 
        message: 'Team member not found' 
      });
    }
    
    member.roles = roles;
    await member.save();
    
    res.status(200).json({ 
      success: true,
      data: { member },
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
        'Bell System': 'Hệ thống chuông báo'
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
    
    const member = await SupportTeamMember.getMemberByUserId(userId);
    
    if (!member) {
      return res.status(404).json({ 
        success: false, 
        message: 'Team member not found' 
      });
    }
    
    await member.updateStats({
      totalTickets,
      resolvedTickets,
      averageRating
    });
    
    res.status(200).json({ 
      success: true,
      data: { member },
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

