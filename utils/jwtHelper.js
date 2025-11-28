const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'breakpoint';
const SERVICE_USER_EMAIL = 'system@ticket-service.wellspring.edu.vn';

/**
 * Tạo JWT token cho service-to-service authentication
 * @param {Object} payload - Payload bổ sung (optional)
 * @param {Number} expiresIn - Thời gian expire (default: 1 giờ)
 * @returns {String} JWT token
 */
const createServiceToken = (payload = {}, expiresIn = '1h') => {
  try {
    const tokenPayload = {
      user: SERVICE_USER_EMAIL,
      service: 'ticket-service',
      type: 'service',
      iss: 'ticket-service',
      aud: 'frappe',
      ...payload,
      iat: Math.floor(Date.now() / 1000)
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn
    });

    console.log(`🔐 [JWT] Created service token for ${SERVICE_USER_EMAIL} (expires in ${expiresIn})`);
    return token;
  } catch (error) {
    console.error('❌ [JWT] Error creating service token:', error.message);
    throw error;
  }
};

/**
 * Verify JWT token
 * @param {String} token - JWT token
 * @returns {Object|null} Decoded payload hoặc null nếu invalid
 */
const verifyServiceToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'ticket-service',
      audience: 'frappe'
    });

    if (decoded.type !== 'service') {
      console.warn('⚠️ [JWT] Token is not a service token');
      return null;
    }

    return decoded;
  } catch (error) {
    console.error('❌ [JWT] Error verifying service token:', error.message);
    return null;
  }
};

/**
 * Tạo headers với JWT token cho API calls
 * @param {Object} additionalHeaders - Headers bổ sung (optional)
 * @returns {Object} Headers object
 */
const getServiceAuthHeaders = (additionalHeaders = {}) => {
  const token = createServiceToken();

  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Service-Name': 'ticket-service',
    'X-Request-Source': 'service-to-service',
    ...additionalHeaders
  };
};

module.exports = {
  createServiceToken,
  verifyServiceToken,
  getServiceAuthHeaders,
  SERVICE_USER_EMAIL,
  JWT_SECRET
};
