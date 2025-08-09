const axios = require('axios');
const mongoose = require('mongoose');
const User = require('../models/Users');

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

// Try validating token via custom ERP endpoint first, then fallback to Frappe default
async function resolveFrappeUserByToken(token) {
  // 1) Try ERP custom endpoint that returns user object with status success
  try {
    const erpResp = await axios.get(
      `${FRAPPE_API_URL}/api/method/erp.api.erp_common_user.auth.get_current_user`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Frappe-CSRF-Token': token,
        },
        timeout: 15000,
      }
    );
    if (erpResp.data?.status === 'success' && erpResp.data.user) {
      return erpResp.data.user; // { name, email, full_name, ... }
    }
  } catch (e) {
    // continue to fallback
  }

  // 2) Fallback: Frappe default get_logged_user -> fetch User doc
  const loggedResp = await axios.get(
    `${FRAPPE_API_URL}/api/method/frappe.auth.get_logged_user`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Frappe-CSRF-Token': token,
      },
      timeout: 15000,
    }
  );

  if (!loggedResp.data?.message) return null;

  const userResp = await axios.get(
    `${FRAPPE_API_URL}/api/resource/User/${loggedResp.data.message}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Frappe-CSRF-Token': token,
      },
      timeout: 15000,
    }
  );

  return userResp.data?.data || null;
}

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    let frappeUser = null;
    try {
      frappeUser = await resolveFrappeUserByToken(token);
    } catch (e) {
      // fallthrough to error handling below
    }

    if (!frappeUser) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    // Try to map to local User in MongoDB by email first, then by fullname
    let localUser = await User.findOne({ email: frappeUser.email });
    if (!localUser && (frappeUser.full_name || frappeUser.fullname)) {
      localUser = await User.findOne({ fullname: frappeUser.full_name || frappeUser.fullname });
    }

    if (!localUser) {
      return res.status(401).json({
        success: false,
        message: 'User not provisioned in ticket-service database.'
      });
    }

    // Map to our auth user format using local ObjectId
    req.user = {
      _id: localUser._id,
      fullname: localUser.fullname || frappeUser.full_name || frappeUser.name,
      email: localUser.email || frappeUser.email,
      role: localUser.role || frappeUser.role || 'user',
      avatarUrl: localUser.avatarUrl || frappeUser.user_image || '',
      department: localUser.department || frappeUser.department || '',
      phone: localUser.phone || frappeUser.phone || '',
      isActive: !localUser.disabled,
    };

    next();
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