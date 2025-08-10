const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticketController");
const { authenticate } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadTicket");
const uploadMessage = require("../middleware/uploadMessage");

// a) Tạo ticket
router.post("/", authenticate, upload.array("attachments", 15), ticketController.createTicket);
router.get("/technical-stats/:userId", ticketController.getTechnicalStats);
router.get("/support-team", ticketController.getSupportTeam);
router.get("/", authenticate, ticketController.getTickets);
router.get("/me", authenticate, ticketController.getMe);
router.get("/:ticketId", authenticate, ticketController.getTicketById);
router.get("/:ticketId/group-chat", authenticate, ticketController.getTicketGroupChat);
router.post("/:ticketId/group-chat", authenticate, ticketController.createTicketGroupChat);
router.post("/:ticketId/group-chat/join", authenticate, ticketController.joinTicketGroupChat);
router.get("/:ticketId/group-chat/debug", authenticate, ticketController.debugTicketGroupChat);
router.put("/:ticketId", authenticate, ticketController.updateTicket);
router.post("/:ticketId/feedback", authenticate, ticketController.addFeedback);
router.post("/:ticketId/escalate", authenticate, ticketController.escalateTicket);
router.post("/:ticketId/messages", authenticate, uploadMessage.single("file"), ticketController.sendMessage);
router.get("/:ticketId/messages", authenticate, ticketController.getTicketMessages);
router.post("/:ticketId/subtasks", authenticate, ticketController.addSubTask);
router.get("/:ticketId/subtasks", authenticate, ticketController.getSubTasksByTicket);
router.put("/:ticketId/subtasks/:subTaskId", authenticate, ticketController.updateSubTaskStatus);
router.delete("/:ticketId/subtasks/:subTaskId", authenticate, ticketController.deleteSubTask);
router.post("/support-team/add-user", ticketController.addUserToSupportTeam);
router.post("/support-team/remove-user", ticketController.removeUserFromSupportTeam);

module.exports = router;