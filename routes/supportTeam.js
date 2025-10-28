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

// 📖 PUBLIC Endpoints (No Authentication Required)
// - /roles: Danh sách các role hỗ trợ
// - /frappe-users: Danh sách tất cả user từ Frappe để chọn

// Lấy danh sách available roles (PUBLIC)
router.get("/roles", supportTeamController.getAvailableRoles);

// Lấy danh sách Frappe users (PUBLIC - để searchable combobox)
router.get("/frappe-users", supportTeamController.getFrappeUsers);

// Lấy members theo role (AUTHENTICATED)
router.get("/by-role/:role", authenticate, supportTeamController.getMembersByRole);

// Lấy tất cả team members (AUTHENTICATED)
router.get("/", authenticate, supportTeamController.getAllTeamMembers);

// Lấy team member theo userId (AUTHENTICATED)
router.get("/:userId", authenticate, supportTeamController.getTeamMemberById);

// Tạo hoặc cập nhật team member (AUTHENTICATED)
router.post("/", authenticate, supportTeamController.createOrUpdateTeamMember);

// Cập nhật roles của member (AUTHENTICATED)
router.put("/:userId/roles", authenticate, supportTeamController.updateTeamMemberRoles);

// Cập nhật stats của member (AUTHENTICATED)
router.put("/:userId/stats", authenticate, supportTeamController.updateMemberStats);

// Xóa team member (AUTHENTICATED)
router.delete("/:userId", authenticate, supportTeamController.deleteTeamMember);

module.exports = router;

