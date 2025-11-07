const axios = require('axios');

/**
 * Frappe API Service
 * 🔐 Unified service để gọi Frappe API với xác thực đồng bộ
 */

// Configuration từ environment
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';
const API_TIMEOUT = parseInt(process.env.AUTH_TIMEOUT) || 5000;

// Tạo axios instance với default config
const frappeAxios = axios.create({
  baseURL: FRAPPE_API_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Thêm token vào request headers
 * @param {string} token - Bearer token từ client
 */
const addAuthHeaders = (token) => {
  if (!token) return {};
  
  return {
    'Authorization': `Bearer ${token}`,
    'X-Frappe-CSRF-Token': token
  };
};

/**
 * 🔑 Verify token và lấy thông tin user hiện tại
 * @param {string} token - Bearer token
 * @returns {Promise} - User information từ Frappe
 */
const verifyTokenAndGetUser = async (token) => {
  try {
    console.log('🔍 [Frappe Service] Verifying token with Frappe...');
    
    // Bước 1: Lấy logged user
    const userResponse = await frappeAxios.get('/api/method/frappe.auth.get_logged_user', {
      headers: addAuthHeaders(token)
    });

    if (!userResponse.data?.message) {
      throw new Error('No user information in Frappe response');
    }

    const userName = userResponse.data.message;
    console.log(`✅ [Frappe Service] Token verified. User: ${userName}`);

    // Bước 2: Lấy full user details
    const userDetails = await getUserDetails(userName, token);
    
    return userDetails;

  } catch (error) {
    console.error('❌ [Frappe Service] Token verification failed:', error.message);
    throw new Error(`Frappe token verification failed: ${error.message}`);
  }
};

/**
 * 📋 Lấy chi tiết user từ Frappe
 * @param {string} userName - User email hoặc username
 * @param {string} token - Bearer token
 * @returns {Promise} - User details
 */
const getUserDetails = async (userName, token) => {
  try {
    const response = await frappeAxios.get(`/api/resource/User/${userName}`, {
      headers: addAuthHeaders(token)
    });

    if (!response.data?.data) {
      throw new Error('Invalid user data from Frappe');
    }

    const user = response.data.data;
    
    // Normalize roles
    const roles = Array.isArray(user.roles)
      ? user.roles.map(r => typeof r === 'string' ? r : r?.role).filter(Boolean)
      : [];

    return {
      name: user.name,
      email: user.email,
      full_name: user.full_name || user.first_name,
      roles: roles,
      enabled: user.enabled === 1 ? 1 : 0,
      user_image: user.user_image || '',
      department: user.department || '',
      phone: user.phone || '',
      mobile_no: user.mobile_no || ''
    };

  } catch (error) {
    console.error('❌ [Frappe Service] Get user details failed:', error.message);
    throw error;
  }
};

/**
 * 👥 Lấy danh sách users với roles cụ thể
 * @param {string} roleFilter - Role name để filter
 * @param {string} token - Bearer token
 * @returns {Promise<Array>} - List of users
 */
const getUsersByRole = async (roleFilter, token) => {
  try {
    console.log(`📋 [Frappe Service] Fetching users with role: ${roleFilter}`);
    
    const response = await frappeAxios.get('/api/resource/User', {
      params: {
        filters: JSON.stringify([["User", "enabled", "=", 1]]),
        fields: '["name", "email", "full_name", "user_image", "enabled"]',
        limit_page_length: 500
      },
      headers: addAuthHeaders(token)
    });

    if (!response.data?.data) {
      return [];
    }

    // Filter by role on client side (optional: can also use Frappe's role filter)
    const users = response.data.data.map(u => ({
      name: u.name,
      email: u.email,
      full_name: u.full_name,
      user_image: u.user_image,
      enabled: u.enabled
    }));

    console.log(`✅ [Frappe Service] Fetched ${users.length} users`);
    return users;

  } catch (error) {
    console.error('❌ [Frappe Service] Get users by role failed:', error.message);
    throw error;
  }
};

/**
 * ✅ Check xem user có role cụ thể không
 * @param {string} userName - User email hoặc username
 * @param {string} role - Role name
 * @param {string} token - Bearer token
 * @returns {Promise<boolean>}
 */
const hasRole = async (userName, role, token) => {
  try {
    const user = await getUserDetails(userName, token);
    return user.roles.includes(role);
  } catch (error) {
    console.error(`❌ [Frappe Service] Check role failed for ${userName}:`, error.message);
    return false;
  }
};

/**
 * 📝 Gọi Frappe method (có thể là server method custom)
 * @param {string} methodName - Method name trong format 'module.method_name'
 * @param {Object} params - Parameters
 * @param {string} token - Bearer token
 * @returns {Promise} - Method result
 */
const callMethod = async (methodName, params = {}, token) => {
  try {
    console.log(`🔧 [Frappe Service] Calling method: ${methodName}`);
    
    const response = await frappeAxios.post(`/api/method/${methodName}`, params, {
      headers: addAuthHeaders(token)
    });

    console.log(`✅ [Frappe Service] Method ${methodName} executed successfully`);
    return response.data?.message;

  } catch (error) {
    console.error(`❌ [Frappe Service] Call method failed (${methodName}):`, error.message);
    throw error;
  }
};

/**
 * 🗂️ Lấy document từ Frappe
 * @param {string} doctype - Document type (e.g., 'User', 'Department')
 * @param {string} name - Document name/id
 * @param {Object} options - Additional options
 * @param {string} token - Bearer token
 * @returns {Promise} - Document data
 */
const getDocument = async (doctype, name, options = {}, token) => {
  try {
    console.log(`📖 [Frappe Service] Fetching ${doctype}: ${name}`);
    
    const params = {
      fields: options.fields || '["*"]',
      ...options
    };

    const response = await frappeAxios.get(`/api/resource/${doctype}/${name}`, {
      params,
      headers: addAuthHeaders(token)
    });

    console.log(`✅ [Frappe Service] Retrieved ${doctype}: ${name}`);
    return response.data?.data;

  } catch (error) {
    console.error(`❌ [Frappe Service] Get document failed (${doctype}):`, error.message);
    throw error;
  }
};

/**
 * 📋 Lấy danh sách documents từ Frappe
 * @param {string} doctype - Document type
 * @param {Object} filters - Filters
 * @param {Object} options - Additional options (fields, limit, etc)
 * @param {string} token - Bearer token
 * @returns {Promise<Array>}
 */
const getDocuments = async (doctype, filters = {}, options = {}, token) => {
  try {
    console.log(`📋 [Frappe Service] Fetching ${doctype} list`);
    
    const params = {
      fields: options.fields || '["*"]',
      limit_page_length: options.limit || 100,
      ...options
    };

    // Nếu có filters, thêm vào
    if (Object.keys(filters).length > 0) {
      const filterArray = Object.entries(filters).map(([key, value]) => [doctype, key, '=', value]);
      params.filters = JSON.stringify(filterArray);
    }

    const response = await frappeAxios.get(`/api/resource/${doctype}`, {
      params,
      headers: addAuthHeaders(token)
    });

    console.log(`✅ [Frappe Service] Retrieved ${response.data.data?.length || 0} ${doctype} documents`);
    return response.data?.data || [];

  } catch (error) {
    console.error(`❌ [Frappe Service] Get documents failed (${doctype}):`, error.message);
    throw error;
  }
};

/**
 * 💾 Tạo hoặc cập nhật document trong Frappe
 * @param {string} doctype - Document type
 * @param {string} name - Document name (optional, for update)
 * @param {Object} data - Document data
 * @param {string} token - Bearer token
 * @returns {Promise} - Created/Updated document
 */
const saveDocument = async (doctype, name, data, token) => {
  try {
    const isUpdate = !!name;
    const method = isUpdate ? 'put' : 'post';
    const endpoint = isUpdate ? `/api/resource/${doctype}/${name}` : `/api/resource/${doctype}`;
    
    console.log(`💾 [Frappe Service] ${isUpdate ? 'Updating' : 'Creating'} ${doctype}${isUpdate ? ': ' + name : ''}`);
    
    const response = await frappeAxios[method](endpoint, data, {
      headers: addAuthHeaders(token)
    });

    console.log(`✅ [Frappe Service] Document ${isUpdate ? 'updated' : 'created'} successfully`);
    return response.data?.data;

  } catch (error) {
    console.error(`❌ [Frappe Service] Save document failed (${doctype}):`, error.message);
    throw error;
  }
};

/**
 * ❌ Xóa document từ Frappe
 * @param {string} doctype - Document type
 * @param {string} name - Document name
 * @param {string} token - Bearer token
 * @returns {Promise}
 */
const deleteDocument = async (doctype, name, token) => {
  try {
    console.log(`🗑️  [Frappe Service] Deleting ${doctype}: ${name}`);
    
    const response = await frappeAxios.delete(`/api/resource/${doctype}/${name}`, {
      headers: addAuthHeaders(token)
    });

    console.log(`✅ [Frappe Service] Document deleted successfully`);
    return response.data;

  } catch (error) {
    console.error(`❌ [Frappe Service] Delete document failed (${doctype}):`, error.message);
    throw error;
  }
};

/**
 * 🔍 Search documents trong Frappe
 * @param {string} doctype - Document type
 * @param {string} searchTerm - Search term
 * @param {Array<string>} fields - Fields để search
 * @param {string} token - Bearer token
 * @returns {Promise<Array>}
 */
const searchDocuments = async (doctype, searchTerm, fields = ['name', 'title'], token) => {
  try {
    console.log(`🔍 [Frappe Service] Searching ${doctype} for: "${searchTerm}"`);
    
    // Tạo filters để search
    const filters = fields.map(field => [doctype, field, 'like', `%${searchTerm}%`]);

    const response = await frappeAxios.get(`/api/resource/${doctype}`, {
      params: {
        filters: JSON.stringify(filters),
        fields: '["*"]',
        limit_page_length: 50
      },
      headers: addAuthHeaders(token)
    });

    console.log(`✅ [Frappe Service] Search returned ${response.data.data?.length || 0} results`);
    return response.data?.data || [];

  } catch (error) {
    console.error(`❌ [Frappe Service] Search failed (${doctype}):`, error.message);
    throw error;
  }
};

/**
 * 📤 Upload file đến Frappe
 * @param {Buffer} fileBuffer - File content
 * @param {string} fileName - File name
 * @param {string} folderPath - Folder path (e.g., 'Home/Attachments')
 * @param {string} token - Bearer token
 * @returns {Promise} - File data
 */
const uploadFile = async (fileBuffer, fileName, folderPath, token) => {
  try {
    console.log(`📤 [Frappe Service] Uploading file: ${fileName}`);
    
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), fileName);
    formData.append('folder', folderPath);
    formData.append('is_private', 1);

    const response = await frappeAxios.post('/api/method/upload_file', formData, {
      headers: {
        ...addAuthHeaders(token),
        'Content-Type': 'multipart/form-data'
      }
    });

    console.log(`✅ [Frappe Service] File uploaded successfully`);
    return response.data?.message;

  } catch (error) {
    console.error(`❌ [Frappe Service] Upload file failed:`, error.message);
    throw error;
  }
};

/**
 * 🎯 Kiểm tra quyền truy cập document
 * @param {string} doctype - Document type
 * @param {string} name - Document name
 * @param {string} permType - Permission type ('read', 'write', 'delete')
 * @param {string} token - Bearer token
 * @returns {Promise<boolean>}
 */
const checkPermission = async (doctype, name, permType = 'read', token) => {
  try {
    console.log(`🔐 [Frappe Service] Checking ${permType} permission on ${doctype}: ${name}`);
    
    // Gọi method check_perm_from_frappe
    const result = await callMethod('frappe.client.has_permission', {
      doctype,
      name,
      perm_type: permType
    }, token);

    const hasPermission = result === true || result === 1;
    console.log(`${hasPermission ? '✅' : '❌'} [Frappe Service] Permission check result: ${hasPermission}`);
    
    return hasPermission;

  } catch (error) {
    console.error(`❌ [Frappe Service] Permission check failed:`, error.message);
    return false;
  }
};

module.exports = {
  // Token & User
  verifyTokenAndGetUser,
  getUserDetails,
  getUsersByRole,
  hasRole,
  
  // Methods
  callMethod,
  
  // Documents
  getDocument,
  getDocuments,
  saveDocument,
  deleteDocument,
  searchDocuments,
  
  // Files
  uploadFile,
  
  // Permissions
  checkPermission,
  
  // Utils
  addAuthHeaders,
  frappeAxios
};

