/**
 * Centralized Log Formatting Utility
 * Định nghĩa tất cả format cho ticket history logs
 */

// Helper function to reverse name parts (Nguyễn Hải Linh -> Linh Nguyễn Hải)
function reverseName(fullname) {
  if (!fullname) return fullname;
  const parts = fullname.trim().split(' ');
  if (parts.length <= 1) return fullname;
  const firstName = parts[0];
  const rest = parts.slice(1);
  return rest.join(' ') + ' ' + firstName;
}

/**
 * TICKET CREATION LOGS
 */
const TICKET_LOGS = {
  // Tạo ticket
  TICKET_CREATED: (userName) =>
    `Ticket được tạo bởi <strong>${reverseName(userName)}</strong>`,

  // Auto assign
  AUTO_ASSIGNED: (assigneeName) =>
    `Auto-assigned to <strong>${reverseName(assigneeName)}</strong>`,

  // Manual assign (creator assigns to assignee)
  MANUAL_ASSIGNED: (creatorName, assigneeName) =>
    `<strong>${reverseName(creatorName)}</strong> đã tạo ticket và chỉ định cho <strong>${reverseName(assigneeName)}</strong>`,

  // Status changes
  STATUS_CHANGED: (oldStatus, newStatus, userName) =>
    `Trạng thái ticket được chuyển từ "${oldStatus}" sang "${newStatus}" bởi <strong>${reverseName(userName)}</strong>`,

  // Accept ticket (assign to me)
  TICKET_ACCEPTED: (assigneeName, previousAssigneeName = null) => {
    if (previousAssigneeName) {
      return `<strong>${reverseName(assigneeName)}</strong> đã nhận ticket từ <strong>${reverseName(previousAssigneeName)}</strong>. Trạng thái chuyển sang <strong>Đang xử lý</strong>`;
    }
    return `<strong>${reverseName(assigneeName)}</strong> đã nhận ticket. Trạng thái chuyển sang <strong>Đang xử lý</strong>`;
  },

  // Cancel ticket
  TICKET_CANCELLED: (userName, reason = null) => {
    if (reason) {
      return `<strong>${reverseName(userName)}</strong> đã huỷ ticket. Lý do: <strong>"${reason}"</strong>`;
    }
    return `<strong>${reverseName(userName)}</strong> đã huỷ ticket`;
  },

  // Reopen ticket
  TICKET_REOPENED: (userName, previousStatus) =>
    `<strong>${reverseName(userName)}</strong> đã mở lại ticket. Trạng thái chuyển từ <strong>"${previousStatus}"</strong> sang <strong>"Đang xử lý"</strong>`,

  // Accept feedback
  FEEDBACK_ACCEPTED: (userName, rating) =>
    `<strong>${reverseName(userName)}</strong> đã chấp nhận kết quả với đánh giá <strong>${rating} sao</strong>. Ticket chuyển sang <strong>"Đóng"</strong>`,
};

/**
 * SUBTASK LOGS
 */
const SUBTASK_LOGS = {
  // Create subtask
  SUBTASK_CREATED: (userName, title, status) =>
    `<strong>${reverseName(userName)}</strong> đã tạo subtask <strong>"${title}"</strong>(trạng thái: <strong>${status}</strong>)`,

  // Update subtask status
  SUBTASK_STATUS_CHANGED: (userName, title, oldStatus, newStatus) =>
    `<strong>${reverseName(userName)}</strong> đã đổi trạng thái subtask <strong>"${title}"</strong> từ <strong>${oldStatus}</strong> sang <strong>${newStatus}</strong>`,

  // Delete subtask
  SUBTASK_DELETED: (userName, title) =>
    `<strong>${reverseName(userName)}</strong> đã xoá subtask <strong>"${title}"</strong>`,
};

/**
 * FEEDBACK LOGS
 */
const FEEDBACK_LOGS = {
  // Initial feedback
  FEEDBACK_INITIAL: (userName, rating, comment = null) => {
    if (comment) {
      return `<strong>${reverseName(userName)}</strong> đã đánh giá lần đầu (<strong>${rating}</strong> sao, nhận xét: "<strong>${comment}</strong>")`;
    }
    return `<strong>${reverseName(userName)}</strong> đã đánh giá lần đầu (<strong>${rating}</strong> sao)`;
  },

  // Update feedback
  FEEDBACK_UPDATED: (userName, oldRating, newRating, comment) =>
    `<strong>${reverseName(userName)}</strong> đã cập nhật đánh giá từ <strong>${oldRating}</strong> lên <strong>${newRating}</strong> sao, nhận xét: "<strong>${comment}</strong>"`,
};

/**
 * OTHER LOGS
 */
const OTHER_LOGS = {
  // Escalation
  TICKET_ESCALATED: (userName, level) =>
    `<strong>${reverseName(userName)}</strong> đã nâng cấp ticket lên mức <strong>${level}</strong>`,

  // SLA breach
  SLA_BREACH: (level) =>
    `Hết hạn SLA. Ticket đã được nâng cấp lên mức ${level}`,

  // Field updates
  FIELD_UPDATED: (fieldName, userName) =>
    `Thông tin ${fieldName} được cập nhật bởi <strong>${reverseName(userName)}</strong>`,
};

module.exports = {
  TICKET_LOGS,
  SUBTASK_LOGS,
  FEEDBACK_LOGS,
  OTHER_LOGS,
  reverseName
};
