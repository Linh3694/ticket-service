const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/Users');

// Get JWT secret từ env
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-key';

// 🔵 NEW: Verify JWT locally (FAST & EFFICIENT)
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // 🔑 Verify JWT signature locally (NO Frappe call needed!)
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      console.log('✅ [Auth] JWT verified locally for user:', decoded.email);
    } catch (err) {
      console.warn('⚠️ [Auth] JWT verification failed:', err.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.'
      });
    }

    // 🟢 Token valid! Extract user info từ JWT payload
    if (!decoded.email) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: missing email claim.'
      });
    }

    // 📦 Find user trong MongoDB (đã synced từ Frappe)
    let localUser = await User.findOne({ email: decoded.email });
    
    if (!localUser) {
      // Auto-provision user nếu chưa tồn tại
      console.log(`📝 [Auth] Auto-provisioning user: ${decoded.email}`);
      try {
        localUser = await User.create({
          email: decoded.email,
          fullname: decoded.email || 'Unknown User',
          role: 'user',
          provider: 'frappe',
          active: true,
          disabled: false,
          roles: decoded.roles || []
        });
        console.log(`✅ [Auth] User auto-provisioned: ${decoded.email}`);
      } catch (createErr) {
        // Handle unique index conflict
        if (createErr.code === 11000) {
          localUser = await User.findOne({ email: decoded.email });
        } else {
          throw createErr;
        }
      }
    }

    // ✅ Set authenticated user on request
    req.user = {
      _id: localUser._id,
      fullname: localUser.fullname || decoded.email,
      email: localUser.email,
      role: localUser.role || 'user',
      avatarUrl: localUser.avatarUrl || '',
      department: localUser.department || '',
      roles: localUser.roles || decoded.roles || [],
      isActive: !localUser.disabled
    };

    console.log(`🔐 [Auth] Request authenticated for: ${req.user.email}`);
    next();
  } catch (error) {
    console.error('❌ [Auth] Authentication error:', error.message);
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

    // TODO: Implement API key validation against database
    // For now, just reject
    return res.status(401).json({ 
      success: false, 
      message: 'API key authentication not yet implemented.' 
    });
  } catch (error) {
    console.error('❌ [Auth] API key authentication error:', error.message);
    res.status(401).json({ 
      success: false, 
      message: 'API authentication failed.' 
    });
  }
};

module.exports = { authenticate, authenticateWithAPIKey }; 