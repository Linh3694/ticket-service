# 🔐 Ticket-Service Frappe Authentication Guide

## Tổng Quan

Ticket-service đã được cấu hình để xác thực với Frappe một cách đồng bộ và nhất quán. Hệ thống sử dụng:

1. **Primary**: Xác thực token từ Frappe
2. **Fallback**: Local JWT verification (legacy support)
3. **Sync**: Tự động đồng bộ user info và roles từ Frappe vào MongoDB

## Kiến Trúc

### 1. Xác Thực Request (Authentication)

```
Client Request
    ↓
Middleware: authMiddleware.authenticate()
    ↓
├─ Extract token từ header Authorization: Bearer <token>
│
├─ Gọi frappeService.verifyTokenAndGetUser(token)
│   ├─ Verify token với Frappe API
│   ├─ Lấy logged user name
│   └─ Lấy full user details
│
├─ Fallback: Local JWT verification
│   └─ jwt.verify(token, JWT_SECRET)
│
├─ Sync user vào MongoDB
│   └─ User.findOneAndUpdate()
│
└─ Set req.user object
    ↓
    Route Handler
```

### 2. Service Layer: frappeService.js

**Vị trí**: `services/frappeService.js`

**Chức năng chính**:
- Token verification
- User management
- Document CRUD
- Permission checking
- Method calling

**API Methods**:

```javascript
// Token & User
verifyTokenAndGetUser(token)
getUserDetails(userName, token)
getUsersByRole(roleFilter, token)
hasRole(userName, role, token)

// Methods
callMethod(methodName, params, token)

// Documents
getDocument(doctype, name, options, token)
getDocuments(doctype, filters, options, token)
saveDocument(doctype, name, data, token)
deleteDocument(doctype, name, token)
searchDocuments(doctype, searchTerm, fields, token)

// Files
uploadFile(fileBuffer, fileName, folderPath, token)

// Permissions
checkPermission(doctype, name, permType, token)
```

### 3. Helper Layer: frappeApiHelper.js

**Vị trí**: `utils/frappeApiHelper.js`

**Chức năng**: Wrapper methods dành cho controllers để dễ sử dụng

**Ví dụ sử dụng**:

```javascript
const frappeHelper = require('../utils/frappeApiHelper');

// Trong controller
const getCurrentUser = (req) => {
  return frappeHelper.getCurrentUser(req);
};

const token = frappeHelper.getTokenFromRequest(req);

// Check role
const isAdmin = await frappeHelper.userHasRole(
  userEmail,
  'Administrator',
  token
);

// Gọi method
const result = await frappeHelper.callFrappeMethod(
  'frappe.client.get_list',
  { doctype: 'User' },
  token
);
```

## Cách Sử Dụng

### 1. Lấy User Hiện Tại

```javascript
const frappeHelper = require('../utils/frappeApiHelper');

// Trong controller với authenticate middleware
const user = frappeHelper.getCurrentUser(req);
console.log(user.email, user.roles);
```

### 2. Kiểm Tra User Có Quyền

```javascript
const hasRole = await frappeHelper.userHasRole(
  'user@example.com',
  ['IT Helpdesk', 'Administrator'],
  token
);

if (hasRole) {
  // Thực hiện hành động
}
```

### 3. Lấy List Users Theo Role

```javascript
const result = await frappeHelper.getUsersByRoleFromFrappe(
  'IT Helpdesk',
  token
);

if (result.success) {
  console.log(result.data); // Array of users
}
```

### 4. Gọi Custom Frappe Method

```javascript
const result = await frappeHelper.callFrappeMethod(
  'erpnext.selling.doctype.customer.customer.get_customer_list',
  { filters: { disabled: 0 } },
  token
);

if (result.success) {
  console.log(result.data);
}
```

### 5. Kiểm Tra Permission

```javascript
const hasPermission = await frappeHelper.checkDocumentPermission(
  'Ticket',
  ticketId,
  'write',
  token
);

if (!hasPermission) {
  return res.status(403).json({ message: 'Access denied' });
}
```

### 6. Search Users

```javascript
const result = await frappeHelper.searchUsersInFrappe(
  'john',
  token
);

if (result.success) {
  console.log(result.data); // Array of matching users
}
```

## Environment Configuration

Thêm vào `config.env`:

```env
# Frappe API Configuration
FRAPPE_API_URL=https://admin.sis.wellspring.edu.vn
FRAPPE_API_KEY=your_api_key          # Optional
FRAPPE_API_SECRET=your_api_secret    # Optional
FRAPPE_API_TOKEN=your_token          # Optional

# Authentication Configuration
AUTH_MODE=frappe_api                 # 'frappe_api' or 'local_jwt'
AUTH_TIMEOUT=5000                    # Timeout for Frappe API calls (ms)

# JWT Configuration (fallback)
JWT_SECRET=your_jwt_secret_here
```

## Middleware Usage

### 1. Basic Authentication

```javascript
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

// Tất cả routes được bảo vệ
router.get('/tickets', authenticate, ticketController.getTickets);
```

### 2. Role-Based Access

```javascript
const frappeHelper = require('../utils/frappeApiHelper');

router.post(
  '/tickets',
  authenticate,
  frappeHelper.requireRole(['IT Helpdesk', 'Administrator']),
  ticketController.createTicket
);
```

### 3. Document Permission Check

```javascript
router.put(
  '/tickets/:id',
  authenticate,
  frappeHelper.requireDocumentPermission('write'),
  ticketController.updateTicket
);
```

## Error Handling

### Frappe API Error Response

```javascript
try {
  const user = await frappeService.getUserDetails(userName, token);
} catch (error) {
  // Error format
  console.error(error.message);
  // 'Frappe token verification failed: ...'
}
```

### Controller Error Handling

```javascript
const result = await frappeHelper.callFrappeMethod(
  'method_name',
  params,
  token
);

if (!result.success) {
  return res.status(400).json({
    success: false,
    message: result.error
  });
}
```

## Best Practices

### 1. ✅ Luôn Cache Token từ Request

```javascript
// ✅ Good
const token = frappeHelper.getTokenFromRequest(req);
const user = await frappeHelper.fetchAndSyncUserFromFrappe(email, token);

// ❌ Avoid - asking for token multiple times
const token1 = frappeHelper.getTokenFromRequest(req);
// ... later ...
const token2 = frappeHelper.getTokenFromRequest(req);
```

### 2. ✅ Sử Dụng Helper Methods

```javascript
// ✅ Good
const result = await frappeHelper.callFrappeMethod(methodName, params, token);

// ❌ Avoid - calling axios directly
const response = await axios.get(`${FRAPPE_API_URL}/api/method/...`);
```

### 3. ✅ Check Permission Trước Khi Hành Động

```javascript
// ✅ Good
const hasPermission = await frappeHelper.checkDocumentPermission(
  'Ticket',
  ticketId,
  'write',
  token
);

if (!hasPermission) {
  return res.status(403).json({ message: 'Access denied' });
}

// Update ticket...

// ❌ Avoid - updating without permission check
await Ticket.updateOne({ _id: ticketId }, updates);
```

### 4. ✅ Handle Errors Gracefully

```javascript
// ✅ Good
try {
  const user = await frappeHelper.fetchAndSyncUserFromFrappe(email, token);
  if (!user.success) {
    return res.status(400).json(user);
  }
} catch (error) {
  console.error('Sync failed:', error);
  return res.status(500).json({ message: 'Failed to sync user' });
}
```

## Troubleshooting

### 1. "Invalid or expired token"

**Nguyên nhân**: Token hết hạn hoặc không hợp lệ
**Giải pháp**: 
- Refresh token từ client
- Kiểm tra Frappe token lifetime settings

### 2. "Access denied. No token provided"

**Nguyên nhân**: Authorization header không có
**Giải pháp**:
- Kiểm tra client gửi header `Authorization: Bearer <token>`

### 3. "User account is disabled"

**Nguyên nhân**: User bị disable trong Frappe
**Giải pháp**:
- Enable user trong Frappe UI
- Hoặc gọi API từ Frappe để enable

### 4. "Frappe API verification failed"

**Nguyên nhân**: 
- Frappe service down
- FRAPPE_API_URL sai
- Network issue
**Giải pháp**:
- Kiểm tra Frappe service status
- Check FRAPPE_API_URL env var
- Kiểm tra network connectivity

## Logging & Debugging

### Enable Debug Logging

```env
# config.env
LOG_LEVEL=debug
DEBUG_AUTH=1
```

### Console Output

```
🔍 [Auth] Verifying token with Frappe API...
🔍 [Frappe Service] Verifying token with Frappe...
✅ [Frappe Service] Token verified. User: user@example.com
✅ [Auth] Token verified with Frappe for user: user@example.com
✅ [Auth] User synced: user@example.com (roles: IT Helpdesk, User)
🔐 [Auth] Request authenticated for: user@example.com
```

## Flow Diagram

```
┌─────────────────┐
│  Client Request │
│ Authorization   │
│ Bearer: <token> │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ authMiddleware.authenticate()    │
└────────┬────────────────────────┘
         │
         ▼
    ┌────────────┐
    │ Verify     │
    │ Token with │
    │ Frappe     │
    └────┬───────┘
         │ Success
         ▼
  ┌──────────────┐
  │ Get User     │
  │ Details from │
  │ Frappe       │
  └────┬─────────┘
       │
       ▼
  ┌──────────────┐
  │ Sync User    │
  │ to MongoDB   │
  └────┬─────────┘
       │
       ▼
  ┌────────────────┐
  │ Set req.user   │
  │ Call next()    │
  └────┬───────────┘
       │
       ▼
  ┌─────────────┐
  │ Route       │
  │ Handler     │
  │ (Protected) │
  └─────────────┘
```

## Related Files

- `services/frappeService.js` - Main Frappe API service
- `utils/frappeApiHelper.js` - Helper methods for controllers
- `middleware/authMiddleware.js` - Authentication middleware
- `controllers/*.js` - Usage examples

