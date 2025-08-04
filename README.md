# Ticket Service

Microservice quản lý ticket/support tương thích với Frappe ERP.

## Tính năng

- ✅ Tạo và quản lý ticket
- ✅ Phân công ticket cho agent
- ✅ Theo dõi trạng thái ticket
- ✅ Thống kê và báo cáo
- ✅ Real-time updates với Socket.IO
- ✅ Cache với Redis
- ✅ Tương thích với Frappe API
- ✅ Email notifications

## Cài đặt

### Yêu cầu hệ thống

- Node.js 16+
- MariaDB/MySQL
- Redis
- PM2 (cho production)

### Cài đặt dependencies

```bash
npm install
```

### Cấu hình môi trường

Copy file `config.env.example` thành `config.env` và cập nhật các thông số:

```bash
cp config.env.example config.env
```

### Khởi chạy

**Development:**
```bash
npm run dev
```

**Production với PM2:**
```bash
pm2 start ecosystem.config.js
```

## API Endpoints

### REST API

- `POST /api/tickets/create` - Tạo ticket mới
- `GET /api/tickets` - Lấy danh sách ticket
- `GET /api/tickets/:id` - Lấy chi tiết ticket
- `PUT /api/tickets/:id` - Cập nhật ticket
- `POST /api/tickets/:id/assign` - Phân công ticket
- `POST /api/tickets/:id/resolve` - Giải quyết ticket
- `GET /api/tickets/user/:user_id` - Lấy ticket của user
- `GET /api/tickets/stats/overview` - Thống kê ticket

### Frappe Compatible API

- `POST /api/method/erp.it.doctype.erp_ticket.erp_ticket.create_ticket`
- `GET /api/method/erp.it.doctype.erp_ticket.erp_ticket.get_user_tickets`
- `GET /api/resource/ERP%20Ticket` - Lấy danh sách ticket
- `GET /api/resource/ERP%20Ticket/:name` - Lấy chi tiết ticket
- `POST /api/resource/ERP%20Ticket` - Tạo ticket
- `PUT /api/resource/ERP%20Ticket/:name` - Cập nhật ticket

## Socket.IO Events

- `join_ticket_room` - Tham gia room theo dõi ticket
- `leave_ticket_room` - Rời room ticket
- `agent_online` - Agent online
- `agent_offline` - Agent offline

## Cấu trúc Database

Bảng `tabERP Ticket` với các trường:
- `name` - ID ticket
- `title` - Tiêu đề
- `description` - Mô tả
- `status` - Trạng thái (open, in_progress, resolved, closed)
- `priority` - Độ ưu tiên (low, medium, high, urgent)
- `ticket_type` - Loại ticket
- `creator` - Người tạo
- `assigned_to` - Người được phân công
- `category` - Danh mục
- `resolution` - Giải pháp
- `created_at` - Thời gian tạo
- `updated_at` - Thời gian cập nhật
- `resolved_at` - Thời gian giải quyết

## License

MIT 