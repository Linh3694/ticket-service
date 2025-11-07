# 📊 Hướng Dẫn Testing Tính Năng Feedback Ticket

## Tổng Quan Tính Năng

Hệ thống đã được cấu hình để:
1. ✅ Gửi feedback từ ticket processing
2. ✅ Lưu trữ feedback vào database
3. ✅ Tính toán rating trung bình cho kỹ thuật viên
4. ✅ Hiển thị badge tổng hợp trên team page

## Luồng Hoạt Động

```
User → TicketProcessing (Frontend)
        ↓
        Chọn sao + Feedback + Badges
        ↓
        acceptFeedback() API call
        ↓
Backend Controller: acceptFeedback()
        ↓
        ✅ Lưu feedback vào Ticket.feedback
        ✅ Chuyển ticket sang Closed
        ✅ Ghi log history
        ↓
Response: { success: true, message: '...' }
        ↓
Frontend reload page
        ↓
Team page tự động load stats via getTeamMemberFeedbackStats()
```

## Test Steps

### 1. Tạo và Xử Lý Ticket

**B1**: Tạo ticket mới
```
Frontend: Create new ticket
Status: Assigned → Processing
```

**B2**: Gán ticket cho kỹ thuật viên
```
Frontend: Click "Nhận Ticket"
Status: Assigned → Processing
```

**B3**: Hoàn thành ticket
```
Backend: Manually change status to Done
hoặc chờ kỹ thuật viên update
```

### 2. Gửi Feedback

**B1**: Mở TicketProcessing component
```
Điều kiện: ticket.status === "Done"
```

**B2**: Chọn option "Chấp nhận kết quả"
```
RadioGroup value: "accepted"
```

**B3**: Điền feedback
```
- Chọn số sao (1-5)
- Nhập comment
- Chọn 1+ badges
```

**B4**: Click "Xác nhận"
```
API Call: POST /api/ticket/{ticketId}/accept-feedback
Body: {
  rating: number,
  comment: string,
  badges: string[]
}
```

### 3. Xác Minh Feedback Được Lưu

**Check Backend Logs**:
```
✅ [acceptFeedback] Feedback saved and ticket closed: {ticketId}
📊 [acceptFeedback] Technician {email} average rating: {rating}
```

**Check Database**:
```javascript
// Mongo query
db.tickets.findOne({
  _id: ObjectId("{ticketId}"),
  status: "Closed"
})

// Should return:
{
  feedback: {
    assignedTo: ObjectId("..."),
    rating: 5,
    comment: "Rất tốt!",
    badges: ["Nhiệt Huyết", "Chu Đáo"]
  },
  status: "Closed"
}
```

### 4. Xác Minh Stats Được Tính

**Check API Response**:
```bash
curl "http://localhost:5001/api/ticket/feedback-stats/technician@example.com"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "averageRating": 4.5,
    "totalFeedbacks": 2,
    "badges": ["Nhiệt Huyết", "Chu Đáo"],
    "badgeCounts": {
      "Nhiệt Huyết": 2,
      "Chu Đáo": 1
    }
  }
}
```

**Check Backend Logs**:
```
📊 [getTeamMemberFeedbackStats] Fetching stats for: {email}
📋 [getTeamMemberFeedbackStats] Found {n} closed tickets with feedback
✅ [getTeamMemberFeedbackStats] Stats: avg rating={rating}, total feedbacks={n}, badges={list}
```

### 5. Xác Minh Hiển Thị Trên Team Page

**Load Team Page**:
```
/applications/ticket/team
```

**Check Columns**:
- ✅ "Đánh giá" column: Hiển thị sao + số rating + số feedback
- ✅ "Huy hiệu" column: Hiển thị badges + số lần được tặng

**Example Display**:
```
Đánh giá: ⭐⭐⭐⭐ 4.5 (2)
Huy hiệu: [Nhiệt Huyết x2] [Chu Đáo]
```

## Debug Checklist

### Nếu feedback không được lưu:

1. **Check Frontend**:
   - ✅ Console log: `handleSubmitFeedback()` được gọi?
   - ✅ Rating > 0?
   - ✅ Comment không trống?
   - ✅ API call được gửi? (Network tab)

2. **Check Backend**:
   - ✅ Route `/api/ticket/{id}/accept-feedback` tồn tại?
   - ✅ Middleware `authenticate` hoạt động?
   - ✅ Console log `acceptFeedback` được in?
   - ✅ Ticket tìm được (không 404)?
   - ✅ Ticket status === 'Done'?

3. **Check Database**:
   - ✅ Ticket tồn tại?
   - ✅ feedback field được update?
   - ✅ Status chuyển sang 'Closed'?

### Nếu stats không được tính:

1. **Check Route**:
   - ✅ Route `/api/ticket/feedback-stats/:email` tồn tại?
   - ✅ Email parameter đúng?

2. **Check Backend Logic**:
   - ✅ SupportTeamMember tìm được bằng email?
   - ✅ Tickets query trả về kết quả?
   - ✅ Status filter là 'Closed'?
   - ✅ Feedback field có data?

3. **Check Frontend**:
   - ✅ `getTeamMemberFeedbackStats` được gọi?
   - ✅ Response data đúng format?
   - ✅ State `feedbackStats` được update?

## API Endpoints

### 1. Accept Feedback
```
POST /api/ticket/:ticketId/accept-feedback
Headers: Authorization: Bearer {token}
Body: {
  rating: 1-5,
  comment: string,
  badges: string[]
}
Response: {
  success: true,
  message: string,
  data: { ticket info }
}
```

### 2. Get Feedback Stats
```
GET /api/ticket/feedback-stats/:email
Response: {
  success: true,
  data: {
    averageRating: number,
    totalFeedbacks: number,
    badges: string[],
    badgeCounts: { [badge]: count }
  }
}
```

### 3. Reopen Ticket
```
POST /api/ticket/:ticketId/reopen
Headers: Authorization: Bearer {token}
Response: {
  success: true,
  message: string,
  data: { ticket info }
}
```

## Common Issues & Solutions

### Issue: "Vui lòng chọn đánh giá từ 1-5 sao"
**Solution**: Rating value phải từ 1-5, kiểm tra radio button selection

### Issue: "Vui lòng nhập feedback"
**Solution**: Comment field không được trống, phải có ít nhất 1 ký tự

### Issue: "Ticket phải ở trạng thái hoàn thành"
**Solution**: Chỉ có thể feedback khi status = 'Done', thay đổi status trước

### Issue: "Chỉ người tạo ticket mới có thể gửi feedback"
**Solution**: Chỉ ticket creator mới có thể gửi feedback, kiểm tra req.user

### Issue: Stats hiển thị 0/5 sao
**Solution**: 
- Kiểm tra SupportTeamMember tồn tại với email này
- Kiểm tra ticket được assign cho member này
- Kiểm tra ticket status = 'Closed'
- Kiểm tra feedback.rating tồn tại

## Database Verification

```javascript
// 1. Kiểm tra Ticket có feedback
db.tickets.find({ "feedback.rating": { $exists: true } }).count()

// 2. Xem feedback chi tiết
db.tickets.findOne(
  { "feedback.rating": { $exists: true } },
  { feedback: 1, assignedTo: 1, status: 1 }
)

// 3. Kiểm tra SupportTeamMember
db.supportteammembers.findOne({ email: "tech@example.com" })

// 4. Đếm feedback theo kỹ thuật viên
db.tickets.aggregate([
  { $match: { assignedTo: ObjectId("..."), status: "Closed" } },
  { $group: { 
      _id: "$assignedTo",
      count: { $sum: 1 },
      avgRating: { $avg: "$feedback.rating" }
  }}
])
```

## Performance Notes

- Stats query được cache trong frontend state
- Load stats cho mỗi member sequentially (nên optimize nếu >100 members)
- Recommendation: Thêm Redis cache cho stats nếu >1000 tickets

## Future Improvements

- [ ] Caching feedback stats (Redis)
- [ ] Batch stats loading (parallel requests)
- [ ] Webhook notification khi feedback received
- [ ] Historical rating trend
- [ ] Badge achievements

