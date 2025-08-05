# Test Kết Nối Frappe

Hướng dẫn test kết nối từ ticket-service đến Frappe API.

## Cách Sử Dụng

### 1. Test Nhanh (Khuyến nghị)

```bash
cd frappe-bench-venv/ticket-service
node quick-test.js
```

### 2. Test Đầy Đủ

```bash
cd frappe-bench-venv/ticket-service
node test-frappe-connection.js
```

## Cấu Hình

### Biến Môi Trường Cần Thiết

Trong file `config.env`:

```env
# Frappe API Configuration
FRAPPE_API_URL=http://172.16.20.130:8000
TEST_FRAPPE_TOKEN=your_test_frappe_token_here  # Tùy chọn
```

### Lấy Token Test

1. Đăng nhập vào Frappe
2. Vào User Profile
3. Tạo API Key và Secret
4. Sử dụng API Key làm `TEST_FRAPPE_TOKEN`

## Các Test Case

### Quick Test (`quick-test.js`)

- ✅ Test kết nối cơ bản
- ✅ Kiểm tra Frappe server có hoạt động không
- ✅ Hiển thị version Frappe

### Full Test (`test-frappe-connection.js`)

- ✅ Test kết nối cơ bản
- ✅ Test authentication endpoint
- ✅ Test system info
- ✅ Test với token hợp lệ (nếu có)

## Kết Quả Mong Đợi

### Thành Công

```
🔍 Quick Frappe Connection Test
📍 URL: http://172.16.20.130:8000
────────────────────────────────────────
Testing connection...
✅ Connection successful!
Status: 200
Frappe version: 14.x.x
```

### Thất Bại

```
🔍 Quick Frappe Connection Test
📍 URL: http://172.16.20.130:8000
────────────────────────────────────────
Testing connection...
❌ Connection failed!
Error: connect ECONNREFUSED 172.16.20.130:8000
💡 Tip: Frappe server might not be running or URL is incorrect
```

## Troubleshooting

### Lỗi Thường Gặp

1. **ECONNREFUSED**

   - Frappe server chưa chạy
   - URL hoặc port sai

2. **ENOTFOUND**

   - URL không đúng
   - DNS không resolve được

3. **401 Unauthorized**
   - Token không hợp lệ
   - Cần kiểm tra quyền truy cập

### Kiểm Tra

1. **Frappe Server**

   ```bash
   # Kiểm tra Frappe có chạy không
   curl http://172.16.20.130:8000/api/method/frappe.utils.get_system_info
   ```

2. **Network Connectivity**

   ```bash
   # Test ping
   ping 172.16.20.130

   # Test port
   telnet 172.16.20.130 8000
   ```

3. **Firewall**
   - Kiểm tra firewall có chặn port 8000 không
   - Kiểm tra network policies

## Lưu Ý

- Đảm bảo đã cài đặt `axios`: `npm install axios`
- File `config.env` phải tồn tại và có cấu hình đúng
- Frappe server phải đang chạy và accessible
