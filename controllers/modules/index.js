// Modular ticket controller - organized by functionality

// Ticket CRUD operations
const ticketOperations = require('./ticketOperations');
const {
  getTechnicalUsers,
  createTicket,
  createTicketFromEmail,
  getTickets,
  getAllTickets,
  getMyTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  assignTicketToMe,
  cancelTicketWithReason,
  reopenTicket
} = ticketOperations;

// Messaging functionality
const messageController = require('./messageController');
const {
  sendMessage,
  getTicketMessages,
  getTicketHistory
} = messageController;

// Subtask management
const subtaskController = require('./subtaskController');
const {
  getSubTasksByTicket,
  addSubTask,
  updateSubTaskStatus,
  deleteSubTask
} = subtaskController;

// Feedback and rating system
const feedbackController = require('./feedbackController');
const {
  acceptFeedback,
  getTeamMemberFeedbackStats,
  getTechnicalStats,
  addFeedback
} = feedbackController;

// Team management
const teamController = require('./teamController');
const {
  getMe,
  getSupportTeam,
  addUserToSupportTeam,
  removeUserFromSupportTeam,
  getTicketCategories,
  debugTeamMembers,
  escalateTicket
} = teamController;

// Export all functions (maintain backward compatibility with original controller)
module.exports = {
  // Ticket operations
  getTechnicalUsers,
  createTicket,
  createTicketFromEmail,
  getTickets,
  getAllTickets,
  getMyTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  assignTicketToMe,
  cancelTicketWithReason,
  reopenTicket,

  // Messaging
  sendMessage,
  getTicketMessages,
  getTicketHistory,

  // Subtasks
  getSubTasksByTicket,
  addSubTask,
  updateSubTaskStatus,
  deleteSubTask,

  // Feedback
  acceptFeedback,
  getTeamMemberFeedbackStats,
  getTechnicalStats,
  addFeedback,

  // Team management
  getMe,
  getSupportTeam,
  addUserToSupportTeam,
  removeUserFromSupportTeam,
  getTicketCategories,
  debugTeamMembers,
  escalateTicket
};
