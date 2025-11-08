/**
 * Centralized Log Formatting Utility
 * Định nghĩa tất cả format cho ticket history logs
 */

// Helper function to normalize Vietnamese names
function normalizeVietnameseName(fullname) {
  if (!fullname) return fullname;
  const parts = fullname.trim().split(' ').filter(word => word.length > 0);
  if (parts.length < 3) return fullname; // Chỉ normalize nếu có 3 từ trở lên

  // Logic đơn giản: Chuyển từ đầu xuống cuối
  // "Linh Nguyễn Hải" -> "Nguyễn Hải Linh"
  const firstWord = parts[0];
  const remainingWords = parts.slice(1);
  const result = `${remainingWords.join(' ')} ${firstWord}`;

  console.log(`🔄 [normalizeVietnameseName] "${fullname}" -> "${result}"`);
  return result;
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

  // Send message
  MESSAGE_SENT: (userName, messagePreview) =>
    `<strong>${normalizeVietnameseName(userName)}</strong> đã gửi tin nhắn: <em>"${messagePreview}"</em>`,

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
