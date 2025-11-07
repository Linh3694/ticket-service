# Ticket Service Migration Guide

## Tổng quan Migration

Phiên bản **ticket-service** này đã được migrate và tích hợp đầy đủ các tính năng từ **workspace-backend ticket system**, với những cải tiến kiến trúc và bảo mật hiện đại.

## ✅ Tính năng đã tích hợp

### 1. **Email Processing với Microsoft Graph API**
- ✅ Đọc email từ Outlook inbox
- ✅ Tự động tạo ticket từ email đến
- ✅ Gửi email thông báo trạng thái ticket
- ✅ Lọc domain và loại bỏ email reply
- ✅ Hỗ trợ attachments

### 2. **Notification System**
- ✅ Push notifications qua Expo
- ✅ Service-to-service notifications
- ✅ Redis pub/sub cho real-time updates
- ✅ Email notifications cho support team

### 3. **File Upload System**
- ✅ Middleware upload cho tickets
- ✅ Middleware upload cho messages
- ✅ Validation file types và size
- ✅ Error handling

### 4. **Authentication & Authorization**
- ✅ Frappe API integration (primary)
- ✅ JWT fallback support
- ✅ Role-based access control
- ✅ User sync từ Frappe qua Redis

### 5. **Real-time Features**
- ✅ Socket.IO integration
- ✅ Redis adapter cho scaling
- ✅ Ticket room management
- ✅ Agent status tracking

### 6. **Advanced Features**
- ✅ SLA calculation
- ✅ Support team management
- ✅ Feedback system với badges
- ✅ Sub-tasks management
- ✅ Comprehensive logging

## 🚀 Cách setup và chạy

### 1. **Cài đặt Dependencies**
```bash
npm install
```

### 2. **Cấu hình Environment**
```bash
cp config.env.example config.env
# Edit config.env với thông tin thực tế
```

### 3. **Chạy Tests**
```bash
npm run test-migration
```

### 4. **Khởi động Service**
```bash
# Development
npm run dev

# Production
npm start
```

## 📋 Cấu hình quan trọng

### **Database (MongoDB)**
```env
MONGODB_URI=mongodb://localhost:27017/wellspring_tickets
MONGODB_HOST=localhost
MONGODB_PORT=27017
MONGODB_DATABASE=wellspring_tickets
```

### **Frappe API Integration**
```env
FRAPPE_API_URL=https://admin.sis.wellspring.edu.vn
FRAPPE_API_KEY=your_frappe_api_key_here
FRAPPE_API_SECRET=your_frappe_api_secret_here
AUTH_MODE=frappe_api
```

### **Email (Microsoft Graph)**
```env
EMAIL_USER=your_email@wellspring.edu.vn
TENANT_ID=your_tenant_id_here
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here
```

### **Redis**
```env
REDIS_HOST=172.16.20.120
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
```

## 🔄 API Endpoints

### **Tickets**
- `POST /api/ticket` - Tạo ticket
- `GET /api/ticket` - Lấy danh sách tickets
- `GET /api/ticket/:id` - Chi tiết ticket
- `PUT /api/ticket/:id` - Cập nhật ticket
- `POST /api/ticket/:id/messages` - Gửi message
- `POST /api/ticket/:id/feedback` - Thêm feedback

### **Email Processing**
- `GET /api/email/fetch-emails` - Đọc và tạo ticket từ email
- `POST /api/email/send-update` - Gửi email cập nhật

### **Support Team**
- `GET /api/ticket/support-team` - Lấy danh sách support team
- `POST /api/ticket/support-team/add-user` - Thêm user vào support team

## 🧪 Testing

Chạy test suite để verify tất cả tính năng:

```bash
npm run test-migration
```

Test bao gồm:
- ✅ Database connections
- ✅ Model validation
- ✅ Notification services
- ✅ Email controllers
- ✅ Upload middleware
- ✅ Routes loading
- ✅ Configuration validation

## 🔒 Bảo mật

- ✅ Không chứa secrets trong code
- ✅ Environment variables cho tất cả credentials
- ✅ Frappe API authentication
- ✅ Input validation và sanitization
- ✅ CORS configuration

## 🚀 Deployment

### **Docker (Khuyến nghị)**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5001
CMD ["npm", "start"]
```

### **PM2 (Production)**
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

## 📊 Monitoring & Health Checks

- ✅ `/health` endpoint với detailed status
- ✅ Database connection monitoring
- ✅ Redis connectivity checks
- ✅ Notification service health

## 🔧 Troubleshooting

### **Common Issues**

1. **MongoDB Connection Failed**
   ```bash
   # Check MongoDB is running
   sudo systemctl status mongod
   ```

2. **Redis Connection Failed**
   ```bash
   # Check Redis connectivity
   redis-cli -h your-redis-host ping
   ```

3. **Frappe API Authentication**
   ```bash
   # Verify Frappe credentials
   curl -H "Authorization: token YOUR_KEY:YOUR_SECRET" YOUR_FRAPPE_URL/api/method/frappe.auth.get_logged_user
   ```

## 🎯 Next Steps

1. **Frontend Integration**: Update frappe-sis-frontend để sử dụng ticket-service APIs
2. **Load Testing**: Test performance với high load
3. **Monitoring Setup**: Add APM và logging aggregation
4. **Backup Strategy**: Setup automated database backups

## 📞 Support

Nếu gặp vấn đề trong quá trình migration hoặc setup, hãy kiểm tra:
- Logs trong console output
- `/health` endpoint status
- Environment variables configuration
- Network connectivity đến external services

---

**Migration completed successfully! 🎉**

All workspace-backend ticket features have been successfully migrated to ticket-service with enhanced architecture and security.
