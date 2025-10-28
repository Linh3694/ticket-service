const express = require("express");
const router = express.Router();
const supportTeamController = require("../controllers/supportTeamController");
const { authenticate } = require("../middleware/authMiddleware");

// ⚠️ IMPORTANT: Route Order Matters!
// Routes với path cụ thể PHẢI khai báo TRƯỚC routes với params động
// Nếu không, Express sẽ match /frappe-users với /:userId trước
// 
// ✅ CORRECT ORDER:
// 1. Specific paths: /roles, /frappe-users, /by-role/:role
// 2. Dynamic paths: /:userId (GET, PUT, DELETE)

// Lấy danh sách available roles
router.get("/roles", authenticate, supportTeamController.getAvailableRoles);

// Lấy danh sách Frappe users (PHẢI trước /:userId!)
router.get("/frappe-users", authenticate, supportTeamController.getFrappeUsers);

// Lấy members theo role
router.get("/by-role/:role", authenticate, supportTeamController.getMembersByRole);

// Lấy tất cả team members (GET without params)
router.get("/", authenticate, supportTeamController.getAllTeamMembers);

// Lấy team member theo userId (ĐỘNG - đặt sau specific paths)
router.get("/:userId", authenticate, supportTeamController.getTeamMemberById);

// Tạo hoặc cập nhật team member
router.post("/", authenticate, supportTeamController.createOrUpdateTeamMember);

// Cập nhật roles của member
router.put("/:userId/roles", authenticate, supportTeamController.updateTeamMemberRoles);

// Cập nhật stats của member
router.put("/:userId/stats", authenticate, supportTeamController.updateMemberStats);

// Xóa team member
router.delete("/:userId", authenticate, supportTeamController.deleteTeamMember);

module.exports = router;

