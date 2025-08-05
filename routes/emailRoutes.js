// /backend/routes/emailRoutes.js
const express = require("express");
const router = express.Router();
const emailController = require("../../controllers/Ticket/emailController");

// Gửi email thông báo ticket
router.post("/send-update", emailController.sendTicketStatusEmail);

// Đọc mail -> Tạo ticket
router.get("/fetch-emails", emailController.fetchEmailsAndCreateTickets);

module.exports = router;