const mongoose = require("mongoose");

const subTaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  status: {
    type: String,
    enum: ["In Progress", "Completed", "Cancelled"],
    default: "Open",
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
const ticketSchema = new mongoose.Schema(
    {
      ticketCode: {
        type: String,
        required: true,
        unique: true, // Đảm bảo không trùng lặp
      },
      title: String,
      description: String,
      category: {
        type: String,
        enum: ["Overall", "Camera", "Network", "Bell System", "Software", "Account", "Email Ticket"],
        required: true,
      },
      priority: {
        type: String,
        enum: ["Low", "Medium", "High", "Urgent"],
        default: "Medium",
      },
      status: {
        type: String,
        enum: ["Assigned", "Processing" , "Waiting for Customer", "Done", "Closed" , "Cancelled"],
        default: "Assigned",
      },
      creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTeamMember", required: false }, // Nhân viên hỗ trợ (từ SupportTeamMember)
     
      // 📝 Timeline tracking
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
      acceptedAt: { type: Date }, // Thời điểm nhân viên tiếp nhận
      closedAt: { type: Date }, // Thời điểm đóng ticket
      
      sla: {
        type: Date, // Hạn chót (deadline) dựa trên priority
      },
      escalateLevel: {
        type: Number,
        default: 0,
      },
      feedback: {
        assignedTo: { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: "User",
        },
        rating: { type: Number, min: 1, max: 5 },
        comment: String,
        badges: [
          {
            type: String, 
            enum: ["Nhiệt Huyết", "Chu Đáo", "Vui Vẻ", "Tận Tình", "Chuyên Nghiệp"], 
            // bạn có thể liệt kê thêm
          }
        ],
      },
      //trao đổi thông tin
      messages: [
        {
          sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          text: String,
          timestamp: { type: Date, default: Date.now },
          type: { type: String, default: "text" },

        },
      ],
      // Lưu nhật ký xử lý
      history: [
        {
          timestamp: Date,
          action: String, // "Ticket created", "Assigned to X", "Escalated", "Status changed to Resolved", ...
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        },
      ],
      // Danh sách file đính kèm
      attachments: [
        {
          filename: { type: String },
          url: { type: String },
        },
      ],
          cancellationReason: { type: String, default: "" },

      subTasks: [subTaskSchema], // ✅ Thêm sub-tasks vào ticket
      notes:{
        type: String,
        default: "",
      }
    },
    { timestamps: true }
  );

  module.exports = mongoose.model("Ticket", ticketSchema);