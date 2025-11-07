const frappeService = require('../services/frappeService');

/**
 * Helper utilities để gọi Frappe API từ controllers
 * ✅ Đóng gói logic common và error handling
 */

/**
 * Lấy user current từ request
 * ⚠️ Chỉ sử dụng sau khi authenticate middleware
 */
const getCurrentUser = (req) => {
  return req.user || null;
};

/**
 * Lấy token từ request
 */
const getTokenFromRequest = (req) => {
  return req.header('Authorization')?.replace('Bearer ', '') || '';
};

/**
 * Lấy user info từ Frappe và sync với MongoDB
 * @param {string} email - User email
 * @param {string} token - Bearer token
 * @returns {Promise<Object>}
 */
const fetchAndSyncUserFromFrappe = async (email, token) => {
  try {
    console.log(`📥 [FrappeHelper] Fetching user from Frappe: ${email}`);
    
    const userInfo = await frappeService.getUserDetails(email, token);
    
    // Normalize roles
    const frappeRoles = Array.isArray(userInfo.roles)
      ? userInfo.roles.filter(Boolean)
      : [];

    console.log(`✅ [FrappeHelper] User fetched: ${email} with roles: ${frappeRoles.join(', ')}`);
    
    return {
      success: true,
      user: {
        name: userInfo.name,
        email: userInfo.email,
        fullName: userInfo.full_name,
        roles: frappeRoles,
        avatar: userInfo.user_image,
        department: userInfo.department,
        phone: userInfo.phone,
        enabled: userInfo.enabled === 1
      }
    };

  } catch (error) {
    console.error(`❌ [FrappeHelper] Failed to fetch user:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Kiểm tra user có role cụ thể
 * @param {string} email - User email
 * @param {string|Array<string>} roles - Role(s) to check
 * @param {string} token - Bearer token
 * @returns {Promise<boolean>}
 */
const userHasRole = async (email, roles, token) => {
  try {
    const userInfo = await frappeService.getUserDetails(email, token);
    const userRoles = Array.isArray(userInfo.roles) ? userInfo.roles : [];
    
    if (Array.isArray(roles)) {
      return roles.some(role => userRoles.includes(role));
    } else {
      return userRoles.includes(roles);
    }

  } catch (error) {
    console.error(`❌ [FrappeHelper] Failed to check role:`, error.message);
    return false;
  }
};

/**
 * Lấy list users theo role
 * @param {string} role - Role name
 * @param {string} token - Bearer token
 * @returns {Promise<Array>}
 */
const getUsersByRoleFromFrappe = async (role, token) => {
  try {
    console.log(`📋 [FrappeHelper] Fetching users with role: ${role}`);
    
    const users = await frappeService.getUsersByRole(role, token);
    
    console.log(`✅ [FrappeHelper] Fetched ${users.length} users`);
    
    return {
      success: true,
      data: users
    };

  } catch (error) {
    console.error(`❌ [FrappeHelper] Failed to get users:`, error.message);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

/**
 * Lấy Department info từ Frappe
 * @param {string} departmentName - Department name
 * @param {string} token - Bearer token
 * @returns {Promise<Object>}
 */
const getDepartmentFromFrappe = async (departmentName, token) => {
  try {
    console.log(`🏢 [FrappeHelper] Fetching department: ${departmentName}`);
    
    const department = await frappeService.getDocument('Department', departmentName, {}, token);
    
    console.log(`✅ [FrappeHelper] Department fetched: ${departmentName}`);
    
    return {
      success: true,
      data: department
    };

  } catch (error) {
    console.error(`❌ [FrappeHelper] Failed to get department:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Search users trong Frappe
 * @param {string} searchTerm - Search term
 * @param {string} token - Bearer token
 * @returns {Promise<Array>}
 */
const searchUsersInFrappe = async (searchTerm, token) => {
  try {
    console.log(`🔍 [FrappeHelper] Searching users: ${searchTerm}`);
    
    const results = await frappeService.searchDocuments('User', searchTerm, ['name', 'email', 'full_name'], token);
    
    console.log(`✅ [FrappeHelper] Search returned ${results.length} results`);
    
    return {
      success: true,
      data: results
    };

  } catch (error) {
    console.error(`❌ [FrappeHelper] Search failed:`, error.message);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

/**
 * Gọi custom Frappe method
 * @param {string} methodName - Method name
 * @param {Object} params - Parameters
 * @param {string} token - Bearer token
 * @returns {Promise<Object>}
 */
const callFrappeMethod = async (methodName, params, token) => {
  try {
    console.log(`🔧 [FrappeHelper] Calling method: ${methodName}`);
    
    const result = await frappeService.callMethod(methodName, params, token);
    
    console.log(`✅ [FrappeHelper] Method executed: ${methodName}`);
    
    return {
      success: true,
      data: result
    };

  } catch (error) {
    console.error(`❌ [FrappeHelper] Method call failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Check permission trên document
 * @param {string} doctype - Document type
 * @param {string} name - Document name
 * @param {string} permType - Permission type (read, write, delete)
 * @param {string} token - Bearer token
 * @returns {Promise<boolean>}
 */
const checkDocumentPermission = async (doctype, name, permType, token) => {
  try {
    return await frappeService.checkPermission(doctype, name, permType, token);
  } catch (error) {
    console.error(`❌ [FrappeHelper] Permission check failed:`, error.message);
    return false;
  }
};

/**
 * Middleware helper: Kiểm tra user có permission
 * Sử dụng như middleware trong routes
 */
const requireRole = (requiredRoles) => {
  return async (req, res, next) => {
    try {
      const user = getCurrentUser(req);
      const token = getTokenFromRequest(req);
      
      if (!user || !token) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Normalize roles
      const rolesArray = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
      
      // Check user roles từ MongoDB (đã sync từ Frappe)
      const userRoles = user.roles || [];
      const hasRequiredRole = rolesArray.some(role => userRoles.includes(role));

      if (!hasRequiredRole) {
        return res.status(403).json({
          success: false,
          message: `Required role(s): ${rolesArray.join(', ')}`
        });
      }

      next();

    } catch (error) {
      console.error('❌ [FrappeHelper] Role check failed:', error.message);
      res.status(500).json({
        success: false,
        message: 'Permission check failed'
      });
    }
  };
};

/**
 * Middleware helper: Kiểm tra permission trên document
 */
const requireDocumentPermission = (permType = 'read') => {
  return async (req, res, next) => {
    try {
      const { doctype, docname } = req.body;
      const token = getTokenFromRequest(req);

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const hasPermission = await checkDocumentPermission(doctype, docname, permType, token);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: `No ${permType} permission for this document`
        });
      }

      next();

    } catch (error) {
      console.error('❌ [FrappeHelper] Document permission check failed:', error.message);
      res.status(500).json({
        success: false,
        message: 'Permission check failed'
      });
    }
  };
};

module.exports = {
  // User utilities
  getCurrentUser,
  getTokenFromRequest,
  fetchAndSyncUserFromFrappe,
  userHasRole,
  getUsersByRoleFromFrappe,
  searchUsersInFrappe,
  
  // Organization utilities
  getDepartmentFromFrappe,
  
  // Method utilities
  callFrappeMethod,
  
  // Permission utilities
  checkDocumentPermission,
  requireRole,
  requireDocumentPermission
};

