const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/Users');
const frappeService = require('../services/frappeService');

// Get JWT secret từ env
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-key';

// 🔄 NEW: Verify JWT với Frappe API (CONSISTENT & RELIABLE)
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    let userInfo;
    try {
      console.log('🔍 [Auth] Verifying token with Frappe API...');

      // Sử dụng frappeService để verify token
      userInfo = await frappeService.verifyTokenAndGetUser(token);
      console.log('✅ [Auth] Token verified with Frappe for user:', userInfo?.email);

    } catch (frappeError) {
      console.warn('⚠️ [Auth] Frappe API verification failed:', frappeError.message);

      // Fallback: try local JWT verification (legacy support)
      console.log('🔄 [Auth] Falling back to local JWT verification...');
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('✅ [Auth] Local JWT verification successful for:', decoded.email);

        // Get user info from JWT payload
        userInfo = {
          name: decoded.name || decoded.username,
          email: decoded.email,
          full_name: decoded.full_name || decoded.fullname,
          roles: decoded.roles || [],
          user_image: decoded.user_image || decoded.avatarUrl,
          department: decoded.department,
          enabled: decoded.enabled !== false ? 1 : 0
        };
      } catch (localError) {
        console.error('❌ [Auth] Both Frappe and local verification failed');
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token.'
        });
      }
    }

    // Validate user info
    if (!userInfo || !userInfo.email) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: missing user information.'
      });
    }

    // Check if user is enabled
    if (userInfo.enabled !== undefined && userInfo.enabled !== 1) {
      return res.status(401).json({
        success: false,
        message: 'User account is disabled.'
      });
    }

    // 📦 Sync/Update user trong MongoDB
    const frappeRoles = Array.isArray(userInfo.roles)
      ? userInfo.roles.map(r => typeof r === 'string' ? r : r?.role).filter(Boolean)
      : [];

    const userData = {
      email: userInfo.email,
      fullname: userInfo.full_name || userInfo.fullname || userInfo.name,
      avatarUrl: userInfo.user_image || userInfo.avatar || '',
      department: userInfo.department || '',
      provider: 'frappe',
      disabled: userInfo.enabled !== 1,
      active: userInfo.enabled === 1,
      roles: frappeRoles,
      role: frappeRoles.length > 0 ? frappeRoles[0].toLowerCase() : 'user',
      updatedAt: new Date()
    };

    let localUser = await User.findOneAndUpdate(
      { email: userInfo.email },
      userData,
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    console.log(`✅ [Auth] User synced: ${localUser.email} (roles: ${frappeRoles.join(', ')})`);

    // ✅ Set authenticated user on request
    req.user = {
      _id: localUser._id,
      fullname: localUser.fullname || userInfo.email,
      email: localUser.email,
      role: localUser.role || 'user',
      avatarUrl: localUser.avatarUrl || '',
      department: localUser.department || '',
      roles: localUser.roles || frappeRoles || [],
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