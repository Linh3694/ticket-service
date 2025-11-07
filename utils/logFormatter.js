/**
 * Centralized Log Formatting Utility
 * Định nghĩa tất cả format cho ticket history logs
 */

// Helper function to normalize Vietnamese names
function normalizeVietnameseName(fullname) {
  if (!fullname) return fullname;
  const parts = fullname.trim().split(' ').filter(word => word.length > 0);
  if (parts.length <= 1) return fullname;

  console.log(`🔄 [normalizeVietnameseName] Input: "${fullname}"`);

  // Danh sách họ Việt Nam phổ biến
  const vietnameseSurnames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];

  // Tìm họ (surname) trong tên và sắp xếp lại thành format chuẩn "Họ + Tên cuối + Tên đầu"
  for (let i = 0; i < parts.length; i++) {
    if (vietnameseSurnames.includes(parts[i])) {
      const surname = parts[i];
      const rest = parts.slice(0, i).concat(parts.slice(i + 1));

      // Với 3 từ: Họ + Tên cuối + Tên đầu (để có format "Nguyễn Hải Linh")
      if (rest.length === 2) {
        const result = `${surname} ${rest[1]} ${rest[0]}`;
        console.log(`🔄 [normalizeVietnameseName] Output: "${result}"`);
        return result;
      }

      // Với nhiều hơn 3 từ hoặc ít hơn, giữ thứ tự gốc
      const result = `${surname} ${rest.join(' ')}`;
      console.log(`🔄 [normalizeVietnameseName] Output: "${result}"`);
      return result;
    }
  }

  // Nếu không tìm thấy họ trong danh sách, giữ nguyên format gốc
  console.log(`🔄 [normalizeVietnameseName] No surname found, returning: "${fullname}"`);
  return fullname;
}

// Helper function to translate status to Vietnamese
function translateStatus(status) {
  const statusMap = {
    "In Progress": "Đang xử lý",
    "Completed": "Hoàn thành",
    "Cancelled": "Đã huỷ",
    "Pending": "Chờ xử lý",
    "Done": "Hoàn thành",
    "Processing": "Đang xử lý",
    "Assigned": "Đã nhận",
    "Waiting for Customer": "Chờ phản hồi",
    "Closed": "Đã đóng"
  };
  return statusMap[status] || status;
}

/**
 * TICKET CREATION LOGS
 */
const TICKET_LOGS = {
  // Tạo ticket
  TICKET_CREATED: (userName) =>
    `Ticket được tạo bởi <strong>${normalizeVietnameseName(userName)}</strong>`,

  // Auto assign
  AUTO_ASSIGNED: (assigneeName) =>
    `Auto-assigned to <strong>${normalizeVietnameseName(assigneeName)}</strong>`,

  // Manual assign (creator assigns to assignee)
  MANUAL_ASSIGNED: (creatorName, assigneeName) =>
    `<strong>${normalizeVietnameseName(creatorName)}</strong> đã tạo ticket và chỉ định cho <strong>${normalizeVietnameseName(assigneeName)}</strong>`,

  // Status changes
  STATUS_CHANGED: (oldStatus, newStatus, userName) =>
    `Trạng thái ticket được chuyển từ "${translateStatus(oldStatus)}" sang "${translateStatus(newStatus)}" bởi <strong>${normalizeVietnameseName(userName)}</strong>`,

  // Accept ticket (assign to me)
  TICKET_ACCEPTED: (assigneeName, previousAssigneeName = null) => {
    if (previousAssigneeName) {
      return `<strong>${normalizeVietnameseName(assigneeName)}</strong> đã nhận ticket từ <strong>${normalizeVietnameseName(previousAssigneeName)}</strong>. Trạng thái chuyển sang <strong>Đang xử lý</strong>`;
    }
    return `<strong>${normalizeVietnameseName(assigneeName)}</strong> đã nhận ticket. Trạng thái chuyển sang <strong>Đang xử lý</strong>`;
  },

  // Cancel ticket
  TICKET_CANCELLED: (userName, reason = null) => {
    if (reason) {
      return `<strong>${normalizeVietnameseName(userName)}</strong> đã huỷ ticket. Lý do: <strong>"${reason}"</strong>`;
    }
    return `<strong>${normalizeVietnameseName(userName)}</strong> đã huỷ ticket`;
  },

  // Reopen ticket
  TICKET_REOPENED: (userName, previousStatus) =>
    `<strong>${normalizeVietnameseName(userName)}</strong> đã mở lại ticket. Trạng thái chuyển từ <strong>"${translateStatus(previousStatus)}"</strong> sang <strong>"Đang xử lý"</strong>`,

  // Accept feedback
  FEEDBACK_ACCEPTED: (userName, rating) =>
    `<strong>${normalizeVietnameseName(userName)}</strong> đã chấp nhận kết quả với đánh giá <strong>${rating} sao</strong>. Ticket chuyển sang <strong>"Đóng"</strong>`,
};

/**
 * SUBTASK LOGS
 */
const SUBTASK_LOGS = {
  // Create subtask
  SUBTASK_CREATED: (userName, title, status) =>
    `<strong>${normalizeVietnameseName(userName)}</strong> đã tạo subtask <strong>"${title}"</strong>(trạng thái: <strong>${translateStatus(status)}</strong>)`,

  // Update subtask status
  SUBTASK_STATUS_CHANGED: (userName, title, oldStatus, newStatus) =>
    `<strong>${normalizeVietnameseName(userName)}</strong> đã đổi trạng thái subtask <strong>"${title}"</strong> từ <strong>${translateStatus(oldStatus)}</strong> sang <strong>${translateStatus(newStatus)}</strong>`,

  // Delete subtask
  SUBTASK_DELETED: (userName, title) =>
    `<strong>${normalizeVietnameseName(userName)}</strong> đã xoá subtask <strong>"${title}"</strong>`,
};


/**
 * OTHER LOGS
 */
const OTHER_LOGS = {
  // Escalation
  TICKET_ESCALATED: (userName, level) =>
    `<strong>${normalizeVietnameseName(userName)}</strong> đã nâng cấp ticket lên mức <strong>${level}</strong>`,

  // SLA breach
  SLA_BREACH: (level) =>
    `Hết hạn SLA. Ticket đã được nâng cấp lên mức ${level}`,

  // Field updates
  FIELD_UPDATED: (fieldName, userName) =>
    `Thông tin ${fieldName} được cập nhật bởi <strong>${normalizeVietnameseName(userName)}</strong>`,
};

module.exports = {
  TICKET_LOGS,
  SUBTASK_LOGS,
  OTHER_LOGS,
  normalizeVietnameseName,
  translateStatus
};
