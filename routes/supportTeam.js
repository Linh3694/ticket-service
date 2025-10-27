const express = require("express");
const router = express.Router();
const supportTeamController = require("../controllers/supportTeamController");
const { authenticate } = require("../middleware/authMiddleware");

// Lấy danh sách available roles
router.get("/roles", authenticate, supportTeamController.getAvailableRoles);

// Lấy danh sách Frappe users
router.get("/frappe-users", authenticate, supportTeamController.getFrappeUsers);

// Lấy tất cả team members
router.get("/", authenticate, supportTeamController.getAllTeamMembers);

// Lấy members theo role
router.get("/by-role/:role", authenticate, supportTeamController.getMembersByRole);

// Lấy team member theo userId
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

