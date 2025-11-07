// /backend/routes/emailRoutes.js
const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");

// Gửi email thông báo ticket
router.post("/send-update", emailController.sendTicketStatusEmail);

// Đọc mail -> Tạo ticket
router.get("/fetch-emails", emailController.fetchEmailsAndCreateTickets);

// Debug: liệt kê 10 email gần nhất trong inbox
// router.get("/peek-inbox", emailController.peekInbox); // Disabled - function not implemented

module.exports = router;