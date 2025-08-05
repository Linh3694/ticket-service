const axios = require('axios');

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    // Validate token with Frappe
    const response = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.auth.get_logged_user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Frappe-CSRF-Token': token
      }
    });

    if (response.data && response.data.message) {
      // Get user details from Frappe
      const userResponse = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${response.data.message}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Frappe-CSRF-Token': token
        }
      });

      if (userResponse.data && userResponse.data.data) {
        const frappeUser = userResponse.data.data;
        
        // Map Frappe user to our format
        req.user = {
          _id: frappeUser.name,
          fullname: frappeUser.full_name || frappeUser.name,
          email: frappeUser.email,
          role: frappeUser.role || 'user',
          avatarUrl: frappeUser.user_image || '',
          department: frappeUser.department || '',
          phone: frappeUser.phone || '',
          isActive: !frappeUser.disabled
        };
        
        next();
      } else {
        return res.status(401).json({ 
          success: false, 
          message: 'User not found in Frappe.' 
        });
      }
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token.' 
      });
    }
  } catch (error) {
    console.error('Frappe authentication error:', error.response?.data || error.message);
    res.status(401).json({ 
      success: false, 
      message: 'Authentication failed.' 
    });
  }
};

// Alternative authentication using API key
const authenticateWithAPIKey = async (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    const apiSecret = req.header('X-API-Secret');
    
    if (!apiKey || !apiSecret) {
      return res.status(401).json({ 
        success: false, 
        message: 'API key and secret required.' 
      });
    }

    // Validate API key with Frappe
    const response = await axios.post(`${FRAPPE_API_URL}/api/method/frappe.auth.validate_api_key_secret`, {
      api_key: apiKey,
      api_secret: apiSecret
    });

    if (response.data && response.data.message) {
      req.user = {
        _id: response.data.message.user,
        fullname: response.data.message.full_name || response.data.message.user,
        email: response.data.message.email,
        role: response.data.message.role || 'user',
        avatarUrl: response.data.message.user_image || '',
        department: response.data.message.department || '',
        phone: response.data.message.phone || '',
        isActive: true
      };
      
      next();
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid API credentials.' 
      });
    }
  } catch (error) {
    console.error('API key authentication error:', error.response?.data || error.message);
    res.status(401).json({ 
      success: false, 
      message: 'API authentication failed.' 
    });
  }
};

module.exports = { authenticate, authenticateWithAPIKey }; 