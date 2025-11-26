const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticketController");
const { authenticate } = require("../middleware/authMiddleware");
const { upload, handleUploadError } = require("../middleware/uploadTicket");

// Ticket routes
// ⚠️ IMPORTANT: Order matters! More specific routes BEFORE dynamic ones (:ticketId)

// Internal routes for service-to-service communication (no authentication required)
const internalRouter = express.Router();

// Email service integration routes
internalRouter.post("/from-email", ticketController.createTicketFromEmail);
internalRouter.get("/info/:ticketId", ticketController.getTicketInfoForEmail);

// Mount internal routes without authentication
router.use("/internal", internalRouter);

// Regular routes with authentication
router.post("/", authenticate, upload.array("attachments", 15), handleUploadError, ticketController.createTicket);
router.get("/categories", ticketController.getTicketCategories);
router.get("/debug/team-members", authenticate, ticketController.debugTeamMembers);
router.get("/technical-stats/:userId", ticketController.getTechnicalStatsByUserId);
router.get("/support-team", ticketController.getSupportTeam);
router.post("/support-team/add-user", ticketController.addUserToSupportTeam);
router.post("/support-team/remove-user", ticketController.removeUserFromSupportTeam);

// Named routes
router.get("/my-tickets", authenticate, ticketController.getMyTickets);
router.get("/all-tickets", authenticate, ticketController.getAllTickets);
router.get("/", authenticate, ticketController.getTickets);
router.get("/me", authenticate, ticketController.getMe);
router.get("/feedback-stats/:email", ticketController.getTeamMemberFeedbackStats);

// Dynamic routes with :ticketId (MUST be last!)
router.get("/:ticketId", authenticate, ticketController.getTicketById);
router.get("/:ticketId/history", authenticate, ticketController.getTicketHistory);
router.put("/:ticketId", authenticate, upload.array("attachments", 15), ticketController.updateTicket);
router.delete("/:ticketId", authenticate, ticketController.deleteTicket);
router.post("/:ticketId/feedback", authenticate, ticketController.addFeedback);
router.post("/:ticketId/escalate", authenticate, ticketController.escalateTicket);
router.post("/:ticketId/messages", authenticate, upload.array("files", 15), handleUploadError, ticketController.sendMessage);
router.get("/:ticketId/messages", authenticate, ticketController.getTicketMessages);
router.post("/:ticketId/subtasks", authenticate, ticketController.addSubTask);
router.get("/:ticketId/subtasks", authenticate, ticketController.getSubTasksByTicket);
router.put("/:ticketId/subtasks/:subTaskId", authenticate, ticketController.updateSubTaskStatus);
router.delete("/:ticketId/subtasks/:subTaskId", authenticate, ticketController.deleteSubTask);
router.put("/:ticketId/assign", authenticate, ticketController.assignTicketToMe);
router.put("/:ticketId/cancel", authenticate, ticketController.cancelTicketWithReason);
router.post("/:ticketId/accept-feedback", authenticate, ticketController.acceptFeedback);
router.post("/:ticketId/reopen", authenticate, ticketController.reopenTicket);

module.exports = router;