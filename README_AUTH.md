# Authentication System - Ticket Service

## Tổng quan

Ticket Service sử dụng **Frappe API Authentication** làm phương thức chính để đảm bảo tính nhất quán với hệ thống Frappe. Authentication middleware sẽ verify JWT token bằng cách gọi Frappe API thay vì verify locally.

## Cách hoạt động

### 1. Primary Authentication (Frappe API)
```javascript
// 1. Nhận JWT token từ request header
const token = req.header('Authorization')?.replace('Bearer ', '');

// 2. Gọi Frappe API để verify token
const response = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.auth.get_logged_user`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Frappe-CSRF-Token': token
  }
});

// 3. Lấy thông tin user chi tiết
const userResponse = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${userId}`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### 2. Fallback Authentication (Local JWT)
Nếu Frappe API không khả dụng, system sẽ fallback về local JWT verification:
```javascript
try {
  const decoded = jwt.verify(token, JWT_SECRET);
  // Extract user info from JWT payload
} catch (error) {
  return res.status(401).json({ message: 'Invalid or expired token.' });
}
```

### 3. User Synchronization
Sau khi verify thành công, user information sẽ được sync vào MongoDB:
```javascript
const userData = {
  email: userInfo.email,
  fullname: userInfo.full_name,
  roles: frappeRoles,
  avatarUrl: userInfo.user_image,
  department: userInfo.department,
  provider: 'frappe',
  disabled: userInfo.enabled !== 1,
  active: userInfo.enabled === 1
};

await User.findOneAndUpdate(
  { email: userInfo.email },
  userData,
  { upsert: true, new: true }
);
```

## Cấu hình Environment Variables

### Required Variables
```bash
# Frappe API Configuration
FRAPPE_API_URL=https://admin.sis.wellspring.edu.vn
FRAPPE_API_KEY=your_frappe_api_key
FRAPPE_API_SECRET=your_frappe_api_secret

# Authentication Mode
AUTH_MODE=frappe_api  # 'frappe_api' or 'local_jwt'
AUTH_TIMEOUT=5000     # Timeout for Frappe API calls (ms)

# JWT (for fallback)
JWT_SECRET=your_jwt_secret_here
```

### Optional Variables
```bash
# Test token for development
TEST_FRAPPE_TOKEN=your_test_token_here

# Debug logging
DEBUG_AUTH=1
```

## Setup Instructions

### 1. Tạo Frappe API Key
1. Đăng nhập vào Frappe Admin
2. Vào **User** > **API Access**
3. Tạo API Key và API Secret
4. Gán quyền phù hợp cho user

### 2. Cấu hình Environment
```bash
# Copy và điền thông tin
cp config.env.example config.env

# Edit config.env
FRAPPE_API_URL=https://admin.sis.wellspring.edu.vn
FRAPPE_API_KEY=your_api_key_here
FRAPPE_API_SECRET=your_api_secret_here
```

### 3. Test Authentication
```bash
# Chạy test script
node test_auth.js

# Hoặc manual test
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5001/api/ticket/my-tickets
```

## Troubleshooting

### Lỗi thường gặp

#### 1. "Invalid or expired token"
- **Nguyên nhân**: Token không hợp lệ hoặc đã hết hạn
- **Giải pháp**: Đăng nhập lại vào Frappe để lấy token mới

#### 2. "Frappe API verification failed"
- **Nguyên nhân**: Frappe server không khả dụng
- **Giải pháp**:
  - Kiểm tra FRAPPE_API_URL
  - Kiểm tra network connectivity
  - System sẽ tự động fallback về local JWT

#### 3. "User account is disabled"
- **Nguyên nhân**: User bị disable trong Frappe
- **Giải pháp**: Enable user trong Frappe Admin

#### 4. "Missing user information"
- **Nguyên nhân**: Token thiếu thông tin user
- **Giải pháp**: Đảm bảo JWT chứa email claim

### Debug Mode
Enable debug logging:
```bash
DEBUG_AUTH=1
DEBUG_USER_EVENTS=1
```

## Security Considerations

### Best Practices
1. **API Keys**: Lưu trữ an toàn, không commit vào git
2. **Token Timeout**: Sử dụng tokens có thời hạn hợp lý
3. **HTTPS**: Luôn sử dụng HTTPS trong production
4. **Rate Limiting**: Implement rate limiting cho auth endpoints
5. **Audit Logging**: Log tất cả authentication attempts

### Security Headers
```javascript
// Recommended security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
```

## Migration Guide

### Từ Local JWT sang Frappe API Auth

#### Before (Local JWT)
```javascript
// Chỉ verify local
const decoded = jwt.verify(token, JWT_SECRET);
```

#### After (Frappe API Auth)
```javascript
// Verify với Frappe API + fallback
const userInfo = await verifyWithFrappeAPI(token);
// Fallback to local if Frappe fails
const decoded = jwt.verify(token, JWT_SECRET);
```

### Backward Compatibility
- System vẫn support local JWT verification làm fallback
- Không break existing integrations
- Gradual migration possible

## Monitoring

### Key Metrics
- Authentication success/failure rates
- Frappe API response times
- User sync success rates
- Token expiration patterns

### Logging
```javascript
// Authentication events
console.log(`🔐 [Auth] Request authenticated for: ${req.user.email}`);
console.log(`❌ [Auth] Authentication failed: ${error.message}`);
console.log(`🔄 [Auth] Fallback to local JWT for: ${decoded.email}`);
```

## API Reference

### Authentication Endpoints
- `GET /api/ticket/my-tickets` - Require authentication
- `POST /api/ticket` - Require authentication
- `PUT /api/ticket/:id` - Require authentication

### Headers Required
```
Authorization: Bearer <frappe_jwt_token>
X-Frappe-CSRF-Token: <frappe_jwt_token>
```

## Support

For issues related to authentication:
1. Check Frappe server connectivity
2. Verify API keys and permissions
3. Review authentication logs
4. Test with provided test script
