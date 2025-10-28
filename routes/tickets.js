const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticketController");
const { authenticate } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadTicket");
const uploadMessage = require("../middleware/uploadMessage");

// Ticket routes
// ⚠️ IMPORTANT: Order matters! More specific routes BEFORE dynamic ones (:ticketId)

// Static routes
router.post("/", authenticate, upload.array("attachments", 15), ticketController.createTicket);
router.get("/categories", ticketController.getTicketCategories);
router.get("/technical-stats/:userId", ticketController.getTechnicalStats);
router.get("/support-team", ticketController.getSupportTeam);
router.post("/support-team/add-user", ticketController.addUserToSupportTeam);
router.post("/support-team/remove-user", ticketController.removeUserFromSupportTeam);

// Named routes
router.get("/my-tickets", authenticate, ticketController.getMyTickets);
router.get("/", authenticate, ticketController.getTickets);
router.get("/me", authenticate, ticketController.getMe);

// Dynamic routes with :ticketId (MUST be last!)
router.get("/:ticketId", authenticate, ticketController.getTicketById);
router.put("/:ticketId", authenticate, ticketController.updateTicket);
router.post("/:ticketId/feedback", authenticate, ticketController.addFeedback);
router.post("/:ticketId/escalate", authenticate, ticketController.escalateTicket);
router.post("/:ticketId/messages", authenticate, uploadMessage.single("file"), ticketController.sendMessage);
router.get("/:ticketId/messages", authenticate, ticketController.getTicketMessages);
router.post("/:ticketId/subtasks", authenticate, ticketController.addSubTask);
router.get("/:ticketId/subtasks", authenticate, ticketController.getSubTasksByTicket);
router.put("/:ticketId/subtasks/:subTaskId", authenticate, ticketController.updateSubTaskStatus);
router.delete("/:ticketId/subtasks/:subTaskId", authenticate, ticketController.deleteSubTask);

module.exports = router;