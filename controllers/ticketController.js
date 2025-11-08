/**
 * Ticket Controller - Refactored with Modular Architecture
 *
 * Original file: 2429 lines → Now organized into focused modules:
 * - ticketOperations.js: CRUD operations for tickets
 * - messageController.js: Chat/messaging functionality
 * - subtaskController.js: Subtask management
 * - feedbackController.js: Rating and feedback system
 * - teamController.js: Team management and user operations
 *
 * Benefits:
 * - Better maintainability and code organization
 * - Easier testing of individual modules
 * - Reduced cognitive load when working on specific features
 * - Clear separation of concerns
 *
 * This maintains backward compatibility while improving maintainability.
 */

// Import all modular controllers
const modules = require('./modules');

// Re-export all functions to maintain backward compatibility
module.exports = modules;
