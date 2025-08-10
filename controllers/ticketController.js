const Ticket = require("../models/Ticket");
const SupportTeam = require("../models/SupportTeam");
const Chat = require("../models/Chat");
const User = require("../models/Users");
const notificationService = require('../services/notificationService'); // Thay thế bằng notificationService
const mongoose = require("mongoose");
const axios = require('axios');

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';

// Helper function to get user from Frappe
async function getFrappeUser(userId, token) {
  try {
    const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Frappe-CSRF-Token': token
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('Error getting user from Frappe:', error);
    return null;
  }
}

// Helper function to find admin users from local DB
async function getAdminUsers() {
  try {
    const admins = await User.find({ role: "admin" });
    return admins;
  } catch (error) {
    console.error('Error getting admin users:', error);
    return [];
  }
}

// Build auth headers for Frappe requests (prefer API key/secret; fallback to FRAPPE_API_TOKEN if provided)
function buildFrappeHeaders() {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.FRAPPE_API_KEY && process.env.FRAPPE_API_SECRET) {
    headers['Authorization'] = `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`;
    return headers;
  }
  if (process.env.FRAPPE_API_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.FRAPPE_API_TOKEN}`;
    headers['X-Frappe-CSRF-Token'] = process.env.FRAPPE_API_TOKEN;
    return headers;
  }
  return headers;
}

// Helper: lấy user kỹ thuật ưu tiên từ DB local theo Frappe Role, fallback gọi Frappe
async function getUsersByFrappeRole(roleName = 'IT Helpdesk', bearerToken = null) {
  try {
    // 1) Ưu tiên lấy từ DB local (đã được đồng bộ bằng pub/sub hoặc các lần gọi trước)
    // - Ưu tiên field roles (multi-roles từ Frappe)
    // - Fallback thêm legacy role === 'technical'
    const localTechnicals = await User.find({
      $or: [
        { roles: roleName },
        { role: 'technical' },
      ],
      // Ưu tiên không disabled; không bắt buộc cờ 'active' vì có thể chưa đồng bộ từ Frappe
      disabled: { $ne: true },
    }).lean();

    if (Array.isArray(localTechnicals) && localTechnicals.length > 0) {
      return localTechnicals;
    }

    // 2) Fallback: gọi trực tiếp Frappe để lấy danh sách user có role
    const headers = buildFrappeHeaders();
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
      headers['X-Frappe-CSRF-Token'] = bearerToken;
    }
    const response = await axios.get(`${FRAPPE_API_URL}/api/resource/Has Role`, {
      params: {
        fields: JSON.stringify(['parent']),
        filters: JSON.stringify([["role","=", roleName]]),
        limit_page_length: 1000,
      },
      headers,
    });

    const frappeUserIds = (response.data?.data || []).map(r => r.parent);
    if (frappeUserIds.length === 0) return [];

    const createdLocals = [];
    for (const frappeUserId of frappeUserIds) {
      try {
        const userResp = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${frappeUserId}`, {
          headers,
          params: {
            fields: JSON.stringify(['name','email','full_name','user_image','enabled','department'])
          }
        });
        const fu = userResp.data?.data;
        if (!fu) continue;

        const local = await User.findOneAndUpdate(
          { email: fu.email },
          {
            email: fu.email,
            fullname: fu.full_name || fu.name,
            avatarUrl: fu.user_image || '',
            department: fu.department || '',
            role: 'technical',
            provider: 'frappe',
            active: fu.enabled === 1,
            disabled: fu.enabled !== 1,
            // đảm bảo roles chứa đúng Frappe Role
            $addToSet: { roles: roleName },
          },
          { new: true, upsert: true }
        );
        createdLocals.push(local);
      } catch (e) {
        console.warn('Failed to sync Frappe user', frappeUserId, e.message);
      }
    }

    return createdLocals;
  } catch (error) {
    console.error('Error getting users by Frappe role:', error.message);
    // fallback cuối: thử lấy từ local thêm lần nữa (phòng khi Frappe lỗi tạm thời)
    try {
      const locals = await User.find({
        $or: [ { roles: roleName }, { role: 'technical' } ],
        active: true,
        disabled: { $ne: true },
      }).lean();
      return locals;
    } catch (_) {
      return [];
    }
  }
}


function getVNTimeString() {
  const now = new Date();
  // Định dạng giờ, phút, ngày, tháng, năm theo múi giờ Việt Nam
  const options = {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };
  // Kết quả dạng: dd/mm/yyyy, hh:mm:ss
  // Ta chỉ lấy: hh:mm (GMT+7) dd/mm/yyyy
  const formatted = new Intl.DateTimeFormat("vi-VN", options).format(now);
  // Tuỳ vào cấu trúc trả về, có thể cần tách chuỗi, nhưng ở mức đơn giản, 
  // bạn có thể thêm thủ công (GMT+7) vào sau:
  return `${formatted}`;
}

function translateStatus(status) {
  const statusMap = {
    "Assigned": "Đã nhận",
    "Processing": "Đang xử lý",
    "In Progress": "Đang xử lý",
    "Completed": "Hoàn thành",
    "Done": "Hoàn thành",
    "Cancelled": "Đã huỷ",
    "Waiting for Customer": "Chờ phản hồi",
    "Closed": "Đã đóng",
  };

  return statusMap[status] || status;
}


// a) Tạo ticket
exports.createTicket = async (req, res) => {
  try {
    const { title, description, priority, creator, notes } = req.body;

    // Try to reuse current user's token to fetch IT Helpdesk list if needed
    const bearerToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim() || null;

    const newTicket = await createTicketHelper({
      title,
      description,
      priority,
      creatorId: creator,
      fallbackCreatorId: req.user?._id,
      bearerToken,
      files: req.files || [],
    });
    // notes
    newTicket.notes = notes || "";
    await newTicket.save();

    // Gửi thông báo đến admin và technical
    await notificationService.sendNewTicketNotification(newTicket);

    res.status(201).json({ success: true, ticket: newTicket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// a) Lấy danh sách ticket
exports.getTickets = async (req, res) => {
  console.log("🔵 Kiểm tra req.user:", req.user); // ✅ Kiểm tra user có tồn tại không

  const { status, priority, userTickets, creator, search } = req.query;
  const userId = req.user._id; // Lấy ID user từ token

  console.log("Query parameters:", { status, priority, userTickets, creator, search });

  try {
    let query = {};

    // Nếu có parameter creator, filter theo creator
    if (creator) {
      query.creator = creator;
      console.log("🔍 Filtering by creator:", creator);
    }
    // Nếu có parameter userTickets, chỉ lấy ticket của user đó
    else if (userTickets) {
      query = { $or: [{ creator: userTickets }, { assignedTo: userTickets }] };
    } else {
    // Nếu không có userTickets, kiểm tra role
      if (req.user.role === "superadmin") {
        query = {}; // Lấy tất cả ticket
      } else {
        // Các role khác: xem ticket mà họ tạo ra hoặc được gán cho họ
        query = { $or: [{ creator: userId }, { assignedTo: userId }] };
      }
    }

    // Add search functionality
    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { ticketCode: { $regex: search, $options: 'i' } }
        ]
      });
    }

    if (status === "assignedOrProcessing") {
      query.status = { $in: ["Assigned", "Processing"] };
    } else if (status) {
      // Các trường hợp khác
      query.status = status;
    }
    if (priority) query.priority = priority;

    console.log("Final query:", JSON.stringify(query, null, 2));

    const tickets = await Ticket.find(query)
      .sort({ createdAt: -1 }) // Sắp xếp giảm dần theo createdAt
      .populate("creator assignedTo");

    console.log("Found tickets:", tickets.length);

    res.status(200).json({ success: true, tickets });
  } catch (error) {
    console.error("Error in getTickets:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Ví dụ thêm 1 API getTicketById
exports.getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.ticketId)
      .populate("creator assignedTo")
      .populate({
        path: "messages.sender",
        model: "User",  // Đảm bảo đúng model User
        select: "fullname avatarUrl email",  // ✅ Chỉ lấy fullname, avatarUrl, email
      })
      // Bổ sung populate cho subTasks.assignedTo:
      .populate({
        path: "subTasks.assignedTo",
        model: "User",
        select: "fullname email avatarUrl",
      });

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    return res.status(200).json({ success: true, ticket });
  } catch (error) {
    console.error("Lỗi khi lấy ticket:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// c) Cập nhật ticket
exports.updateTicket = async (req, res) => {
  const { ticketId } = req.params;
  const updates = req.body;
  const userId = req.user.id;

  try {
    const ticket = await Ticket.findById(ticketId)
      .populate('creator')  // Thêm populate để lấy thông tin creator
      .populate('assignedTo');

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Thêm dòng này để tránh lỗi ReferenceError
    const previousStatus = ticket.status;
    const previousAssignedTo = ticket.assignedTo;

    console.log("Ticket hiện tại:", ticket);
    console.log("Received updates:", updates);

    // Ghi log nếu status thay đổi
    if (updates.status && updates.status !== ticket.status) {
      ticket.history.push({
        timestamp: new Date(),
        action: `<strong>${req.user.fullname}</strong> đã thay đổi trạng thái ticket từ <strong>"${translateStatus(ticket.status)}"</strong> sang <strong>"${translateStatus(updates.status)}"</strong>`,
        user: req.user._id, // luôn là ObjectId từ middleware
      });
    }

    // Nếu có cancelReason, ghi log
    if (updates.status === "Cancelled" && updates.cancelReason) {
      ticket.history.push({
        timestamp: new Date(),
        action: ` <strong>${req.user.fullname}</strong> đã huỷ ticket với lý do: <strong>"${updates.cancelReason}"</strong>`,
        user: req.user._id,
      });
    }

    Object.assign(ticket, updates);

    // Nếu chuyển sang Processing -> cập nhật SLA Phase 2
    if (updates.status === "Processing") {
      const slaDurations = { Low: 72, Medium: 48, High: 24, Urgent: 4 };
      const priority = updates.priority || ticket.priority;
      let slaDeadline = new Date();
      slaDeadline.setHours(slaDeadline.getHours() + slaDurations[priority]);
      ticket.sla = slaDeadline;
      ticket.history.push({
        timestamp: new Date(),
        action: ` <strong>${req.user.fullname}</strong> đã chuyển ticket sang <strong>"Đang xử lý"</strong> `,
        user: req.user._id,
      });
    }

    await ticket.save();
    console.log("Ticket đã được lưu thành công:", ticket);

    // Xác định loại hành động để gửi thông báo phù hợp
    let action = 'updated';
    if (req.body.status && ticket.status !== previousStatus) {
      // Check if we have a specific notifyAction from client
      if (req.body.notifyAction) {
        action = req.body.notifyAction;
      } else {
        action = 'status_updated';
      }
    } else if (req.body.assignedTo && !previousAssignedTo.equals(ticket.assignedTo)) {
      action = 'assigned';
    }

    // Gửi thông báo cập nhật (đã bao gồm thông báo cho creator và superadmin)
    await notificationService.sendTicketUpdateNotification(ticket, action);

    // Nếu đây là action feedback_added, gửi thêm thông báo feedback
    if (action === 'feedback_added' && ticket.feedback) {
      await notificationService.sendFeedbackNotification(ticket);
    }

    res.status(200).json({ success: true, ticket });
  } catch (error) {
    console.error("Lỗi khi cập nhật ticket:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi cập nhật ticket",
    });
  }
};

// d) Thêm phản hồi
exports.addFeedback = async (req, res) => {
  const { ticketId } = req.params;
  const { rating, comment, badges } = req.body; // thêm badges

  try {
    const ticket = await Ticket.findById(ticketId);

    // Kiểm tra xem lần đầu đánh giá hay đã đánh giá trước đó
    const hasPreviousRating = !!ticket.feedback?.rating; // true/false

    if (!hasPreviousRating) {
      // Lần đầu đánh giá:
      // - Không bắt buộc comment
      if (!rating) {
        return res.status(400).json({
          success: false,
          message: "Bạn phải chọn số sao để đánh giá.",
        });
      }

      // Gán giá trị feedback
      ticket.feedback = {
        assignedTo: ticket.assignedTo,
        rating,
        comment: comment || "", // comment không bắt buộc, nếu không có thì lưu chuỗi rỗng
        badges: badges || [], // Gán mảng huy hiệu
      };

      ticket.history.push({
        timestamp: new Date(),
        action: ` <strong>${req.user.fullname}</strong> đã đánh giá lần đầu (<strong>${rating}</strong> sao${comment ? `, nhận xét: "<strong>${comment}</strong>"` : ""})`,
        user: req.user._id,
      });

    } else {
      // Đã có rating trước đó => cập nhật rating
      // - Bắt buộc phải có comment giải thích tại sao muốn đổi
      if (!rating) {
        return res.status(400).json({
          success: false,
          message: "Bạn phải chọn số sao để cập nhật đánh giá.",
        });
      }
      if (!comment) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng nhập nhận xét khi thay đổi đánh giá.",
        });
      }

      const oldRating = ticket.feedback.rating;
      ticket.feedback.assignedTo = ticket.assignedTo;
      ticket.feedback.rating = rating;
      ticket.feedback.comment = comment;
      ticket.feedback.badges = badges || [];

      ticket.history.push({
        timestamp: new Date(),
        action: ` <strong>${req.user.fullname}</strong> đã cập nhật đánh giá từ <strong>${oldRating}</strong> lên <strong>${rating}</strong> sao, nhận xét: "<strong>${comment}</strong>"`,
        user: req.user._id,
      });
    }

    await ticket.save();

    // Gửi thông báo khi khách hàng gửi feedback
    await notificationService.sendFeedbackNotification(ticket);

    return res.status(200).json({
      success: true,
      ticket,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getTechnicalStats = async (req, res) => {
  try {
    // Giả sử req.params.userId là ID của technical ta muốn xem thống kê
    const { userId } = req.params;

    // Tìm tất cả ticket có assignedTo = userId, feedback.rating tồn tại
    const tickets = await Ticket.find({
      assignedTo: userId,
      "feedback.rating": { $exists: true }
    });

    if (!tickets.length) {
      return res.status(200).json({
        success: true,
        averageRating: 0,
        totalFeedbacks: 0,
        badgesCount: {}
      });
    }

    // 1) Tính trung bình rating
    const totalFeedbacks = tickets.length;
    const sumRating = tickets.reduce((sum, t) => sum + t.feedback.rating, 0);
    const averageRating = sumRating / totalFeedbacks;

    // 2) Thống kê huy hiệu
    // feedback.badges là 1 mảng, ta gộp tất cả mảng -> count frequency
    const badgesCount = {}; // { 'Nhiệt Huyết': 2, 'Chu Đáo': 3, ... }
    tickets.forEach(t => {
      if (t.feedback.badges && Array.isArray(t.feedback.badges)) {
        t.feedback.badges.forEach(badge => {
          badgesCount[badge] = (badgesCount[badge] || 0) + 1;
        });
      }
    });

    res.status(200).json({
      success: true,
      averageRating,
      totalFeedbacks,
      badgesCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// e) Escalation
exports.escalateTicket = async (req, res) => {
  const { ticketId } = req.params;

  try {
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    ticket.escalateLevel += 1;
    ticket.history.push({
      timestamp: new Date(),
      action: ` ${req.user.fullname} đã nâng cấp ticket lên mức ${ticket.escalateLevel}`,
      user: req.user._id,
    });

    await ticket.save();

    res.status(200).json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// f) SLA checking (cron job)
exports.checkSLA = async () => {
  const tickets = await Ticket.find({
    status: { $in: ["In Progress"] },
    sla: { $lt: new Date() },
  });

  tickets.forEach(async (ticket) => {
    ticket.escalateLevel += 1;
    ticket.history.push({
      timestamp: new Date(),
      action: `Hết hạn SLA. Ticket đã được nâng cấp lên mức ${ticket.escalateLevel}`,
    });

    // Gửi email thông báo (có thể tích hợp sau)
    await ticket.save();
  });

  console.log(`${tickets.length} tickets escalated due to SLA breach.`);
};

// controllers/ticketController.js
exports.sendMessage = async (req, res) => {
  const { ticketId } = req.params;
  const { text } = req.body;

  try {
    const ticket = await Ticket.findById(ticketId).populate("creator assignedTo");
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Chỉ creator hoặc assignedTo mới được chat
    const isParticipant =
      ticket.creator.equals(req.user._id) ||
      (ticket.assignedTo && ticket.assignedTo.equals(req.user._id));

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền chat trong ticket này",
      });
    }

    // Nếu có file trong req.file => upload ảnh
    if (req.file) {
      // Tạo message kiểu ảnh
      const filePath = `/uploads/Messages/${req.file.filename}`;
      ticket.messages.push({
        sender: req.user._id,
        text: filePath,      // Lưu đường dẫn tương đối thay vì URL đầy đủ
        timestamp: new Date(),
        type: "image",      // Đánh dấu để frontend hiểu đây là ảnh
      });
    } else {
      // Tin nhắn text
      if (!text?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Nội dung tin nhắn trống!",
        });
      }
      ticket.messages.push({
        sender: req.user._id,
        text,
        timestamp: new Date(),
        type: "text",
      });
    }

    await ticket.save();
    // Re-fetch ticket để đảm bảo các trường, bao gồm messages với field type, được populate đầy đủ
    const updatedTicket = await Ticket.findById(ticketId)
      .populate("creator assignedTo")
      .populate({
        path: "messages.sender",
        model: "User",
        select: "fullname avatarUrl email",
      });

    // Emit socket event to broadcast new message với tối ưu
    const lastMessage = updatedTicket.messages[updatedTicket.messages.length - 1];
    const io = req.app.get("io");

    // Broadcast enhanced message data
    const messageData = {
      _id: lastMessage._id,
      text: lastMessage.text,
      sender: lastMessage.sender,
      timestamp: lastMessage.timestamp,
      type: lastMessage.type,
      ticketId: ticketId,
      tempId: req.body.tempId || null,
    };

    // Emit to all clients in ticket room (ensure correct room name)
    io.to(`ticket:${ticketId}`).emit("newMessage", messageData);
    // Backward compatibility for any clients that joined plain room id
    io.to(ticketId).emit("newMessage", messageData);

    // Gửi thông báo có tin nhắn mới - không gửi cho người gửi
    await notificationService.sendTicketUpdateNotification(ticket, 'comment_added', req.user._id);

    return res.status(200).json({
      success: true,
      message: messageData,
      ticket: updatedTicket,
    });
  } catch (error) {
    console.error("Lỗi sendMessage:", error);
    return res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi gửi tin nhắn",
    });
  }
};

exports.addSubTask = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { title, assignedTo, status } = req.body;
    const userId = req.user.id;

    const ticket = await Ticket.findById(ticketId).populate("subTasks.assignedTo");
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại!" });
    }

    // Tìm user theo _id hoặc fullname
    let assignedUser = null;
    if (mongoose.Types.ObjectId.isValid(assignedTo)) {
      assignedUser = await User.findById(assignedTo);
    }
    if (!assignedUser) {
      assignedUser = await User.findOne({ fullname: assignedTo });
    }
    if (!assignedUser) {
      return res.status(400).json({
        success: false,
        message: "User được giao không tồn tại!",
      });
    }

    const validStatuses = ["In Progress", "Completed", "Cancelled"];
    const finalStatus = validStatuses.includes(status) ? status : "In Progress";

    const newSubTask = {
      title,
      assignedTo: assignedUser._id,
      status: finalStatus,
      createdAt: new Date(),
    };

    ticket.subTasks.push(newSubTask);

    // Ghi log
    ticket.history.push({
      timestamp: new Date(),
      action: ` <strong>${req.user.fullname}</strong> đã tạo subtask <strong>"${title}"</strong>(trạng thái: <strong>${finalStatus}</strong>)`,
      user: req.user._id,
    });

    await ticket.save();

    // Populate sau khi thêm
    const updatedTicket = await Ticket.findById(ticketId)
      .populate("creator assignedTo")
      .populate("subTasks.assignedTo");

    res.status(201).json({ success: true, ticket: updatedTicket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSubTaskStatus = async (req, res) => {
  try {
    const { ticketId, subTaskId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    const ticket = await Ticket.findById(ticketId).populate("subTasks.assignedTo");
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    const subTask = ticket.subTasks.id(subTaskId);
    if (!subTask) {
      return res.status(404).json({ success: false, message: "Sub-task không tồn tại" });
    }

    const validStatuses = ["In Progress", "Completed", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Trạng thái không hợp lệ!" });
    }

    // Ghi log nếu trạng thái thay đổi
    if (subTask.status !== status) {
      if (subTask.status !== status) {
        ticket.history.push({
          timestamp: new Date(),
          action: ` <strong>${req.user.fullname}</strong> đã đổi trạng thái subtask <strong>${subTask.title}</strong> từ <strong>${translateStatus(subTask.status)}</strong> sang <strong>${translateStatus(status)}</strong>`,
          user: req.user._id,
        });
      }
    }

    // Cập nhật subtask
    subTask.status = status;
    subTask.updatedAt = new Date();

    await ticket.save();

    res.status(200).json({ success: true, subTask });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteSubTask = async (req, res) => {
  try {
    const { ticketId, subTaskId } = req.params;
    const userId = req.user.id;

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    const subTask = ticket.subTasks.id(subTaskId);
    if (!subTask) {
      return res.status(404).json({ success: false, message: "Sub-task không tồn tại" });
    }

    // Ghi log trước khi xóa
    ticket.history.push({
      timestamp: new Date(),
      action: ` <strong>${req.user.fullname}</strong> đã xoá subtask <strong>"${subTask.title}"</strong>`,
      user: req.user._id,
    });

    ticket.subTasks = ticket.subTasks.filter(
      (s) => s._id.toString() !== subTaskId
    );

    await ticket.save();

    res.status(200).json({ success: true, message: "Sub-task đã được xóa" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSubTasksByTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const ticket = await Ticket.findById(ticketId).populate("subTasks.assignedTo", "fullname email");

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    res.status(200).json({ success: true, subTasks: ticket.subTasks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Lấy danh sách messages của ticket (phân trang)
exports.getTicketMessages = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const ticket = await Ticket.findById(ticketId)
      .populate({
        path: 'messages.sender',
        model: 'User',
        select: 'fullname avatarUrl email',
      })
      .lean();

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket không tồn tại' });
    }

    // Phân quyền cơ bản
    const userId = req.user?._id;
    const hasAccess = ticket.creator?.toString() === userId?.toString() ||
      (ticket.assignedTo && ticket.assignedTo?.toString() === userId?.toString()) ||
      req.user?.role === 'admin' || req.user?.role === 'superadmin';
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xem trao đổi của ticket này' });
    }

    const total = Array.isArray(ticket.messages) ? ticket.messages.length : 0;
    const sliceStart = Math.max(total - skip - limit, 0);
    const sliceEnd = Math.max(total - skip, 0);
    const pageMessages = (ticket.messages || []).slice(sliceStart, sliceEnd);

    return res.status(200).json({
      success: true,
      messages: pageMessages,
      pagination: {
        page,
        limit,
        hasMore: sliceStart > 0,
        total,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Return current authenticated local user (for mobile to get local _id)
exports.getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    return res.status(200).json({ success: true, user: req.user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Lấy supportTeam
exports.getSupportTeam = async (req, res) => {
  try {
    const result = await SupportTeam.getSupportTeamMembers();
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Thêm user vào supportTeam
exports.addUserToSupportTeam = async (req, res) => {
  try {
    const { userId } = req.body;
    const message = await SupportTeam.addMember(userId);
    res.status(200).json({ success: true, message });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// (Tuỳ chọn) Xoá user khỏi supportTeam
exports.removeUserFromSupportTeam = async (req, res) => {
  try {
    const { userId } = req.body;
    const message = await SupportTeam.removeMember(userId, req.user);
    res.status(200).json({ success: true, message });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Lấy group chat của ticket
exports.getTicketGroupChat = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    // Tìm ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Kiểm tra quyền truy cập ticket - superadmin có thể xem tất cả
    const hasAccess = ticket.creator.equals(userId) || 
                     (ticket.assignedTo && ticket.assignedTo.equals(userId)) ||
                     req.user.role === "admin" || 
                     req.user.role === "superadmin";

    if (!hasAccess) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập ticket này" });
    }

    // Lấy group chat (nếu chưa có, trả về hasGroup=false để client hiển thị nút tạo)
    if (!ticket.groupChatId) {
      return res.status(200).json({ success: true, hasGroup: false, canCreate: true, message: "Ticket chưa có group chat" });
    }

    // Gọi chat-service để lấy chi tiết group chat
    const CHAT_BASE = process.env.CHAT_SERVICE_URL || process.env.CHAT_SERVICE_PUBLIC_URL || FRAPPE_API_URL;
    try {
      const chatResp = await axios.get(`${CHAT_BASE}/api/chats/${ticket.groupChatId}`, {
        headers: { Authorization: req.headers['authorization'] || '' }
      });
      const groupChat = chatResp.data;

      // Kiểm tra user có trong group chat không
      const isParticipant = Array.isArray(groupChat.participants)
        && groupChat.participants.some((p) => (p._id || p).toString() === userId.toString());

      if (!isParticipant && req.user.role !== "admin" && req.user.role !== "superadmin") {
        // Thử auto-join nếu là creator/assigned
        const isCreatorOrAssigned = ticket.creator.equals(userId) || (ticket.assignedTo && ticket.assignedTo.equals(userId));
        if (isCreatorOrAssigned) {
          try {
            await axios.post(`${CHAT_BASE}/api/chats/${ticket.groupChatId}/add-user`, { user_id: userId }, {
              headers: {
                Authorization: req.headers['authorization'] || '',
                'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || ''
              }
            });
            // Refetch as participant
            const refetch = await axios.get(`${CHAT_BASE}/api/chats/${ticket.groupChatId}`, {
              headers: { Authorization: req.headers['authorization'] || '' }
            });
            const joinedChat = refetch.data;
            return res.status(200).json({
              success: true,
              hasGroup: true,
              groupChat: joinedChat,
              isParticipant: true,
              canJoin: true,
            });
          } catch (_) {
            // fallthrough to 403 below
          }
        }
        return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập group chat này" });
      }

      return res.status(200).json({
        success: true,
        hasGroup: true,
        groupChat,
        isParticipant,
        canJoin: req.user.role === "admin" || req.user.role === "superadmin" || isParticipant,
      });
    } catch (e) {
      // Nếu chat-service trả về 404, cleanup groupChatId ở ticket
      if (e.response?.status === 404) {
        console.log(`⚠️ Ticket ${ticket.ticketCode} có groupChatId nhưng chat không tồn tại ở chat-service, đang cleanup`);
        await Ticket.findByIdAndUpdate(ticketId, { $unset: { groupChatId: 1 } });
        return res.status(404).json({ success: false, message: "Group chat không tồn tại" });
      }
      // Nếu 403, thử auto-join (khi user là creator/assigned) rồi trả lại
      if (e.response?.status === 403) {
        const isCreatorOrAssigned = ticket.creator.equals(userId) || (ticket.assignedTo && ticket.assignedTo.equals(userId));
        if (isCreatorOrAssigned) {
          try {
            await axios.post(`${CHAT_BASE}/api/chats/${ticket.groupChatId}/add-user`, { user_id: userId }, {
              headers: {
                Authorization: req.headers['authorization'] || '',
                'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || ''
              }
            });
            const refetch = await axios.get(`${CHAT_BASE}/api/chats/${ticket.groupChatId}`, {
              headers: { Authorization: req.headers['authorization'] || '' }
            });
            const joinedChat = refetch.data;
            return res.status(200).json({ success: true, hasGroup: true, groupChat: joinedChat, isParticipant: true, canJoin: true });
          } catch (_) {}
        }
      }
      throw e;
    }
    
  } catch (error) {
    console.error('Lỗi khi lấy group chat của ticket:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Debug endpoint để kiểm tra participants của group chat
exports.debugTicketGroupChat = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    if (!ticket.groupChatId) {
      return res.status(404).json({ success: false, message: "Ticket chưa có group chat" });
    }

    const groupChat = await Chat.findById(ticket.groupChatId)
      .populate('participants', 'fullname email role')
      .populate('creator', 'fullname email role')
      .populate('admins', 'fullname email role');

    const debugInfo = {
      ticketInfo: {
        id: ticket._id,
        code: ticket.ticketCode,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo
      },
      currentUser: {
        id: userId,
        fullname: req.user.fullname,
        role: req.user.role
      },
      groupChatInfo: {
        id: groupChat._id,
        name: groupChat.name,
        participants: groupChat.participants,
        creator: groupChat.creator,
        admins: groupChat.admins,
        participantsCount: groupChat.participants.length
      },
      permissionCheck: {
        isCurrentUserInParticipants: groupChat.participants.some(p => p._id.equals(userId)),
        isCreator: ticket.creator.equals(userId),
        isAssignedTo: ticket.assignedTo && ticket.assignedTo.equals(userId),
        isAdmin: req.user.role === "admin" || req.user.role === "superadmin",
        isCreatorOrAssigned: ticket.creator.equals(userId) || (ticket.assignedTo && ticket.assignedTo.equals(userId))
      }
    };

    res.status(200).json({ success: true, debug: debugInfo });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function createTicketHelper({ title, description, creatorId, fallbackCreatorId = null, priority, files = [], bearerToken = null }) {
  // 1) Tính SLA Phase 1 (4h, 8:00 - 17:00)
  const phase1Duration = 4;
  const startHour = 8;
  const endHour = 17;

  let slaDeadline = new Date();
  const currentHour = slaDeadline.getHours();
  const currentMinute = slaDeadline.getMinutes();

  if (currentHour < startHour || (currentHour === startHour && currentMinute === 0)) {
    slaDeadline.setHours(startHour, 0, 0, 0);
  } else if (currentHour >= endHour || (currentHour === endHour && currentMinute > 0)) {
    slaDeadline.setDate(slaDeadline.getDate() + 1);
    slaDeadline.setHours(startHour, 0, 0, 0);
  }

  let remainingMinutes = phase1Duration * 60;
  while (remainingMinutes > 0) {
    const availableMinutesInDay = endHour * 60 - (slaDeadline.getHours() * 60 + slaDeadline.getMinutes());
    const availableMinutes = Math.min(remainingMinutes, availableMinutesInDay);
    if (availableMinutes <= 0) {
      slaDeadline.setDate(slaDeadline.getDate() + 1);
      slaDeadline.setHours(startHour, 0, 0, 0);
      continue;
    }
    slaDeadline.setMinutes(slaDeadline.getMinutes() + availableMinutes);
    remainingMinutes -= availableMinutes;
  }

  const slaPhase1Deadline = slaDeadline;

  // 2) Tạo ticketCode
  const lastTicket = await Ticket.findOne().sort({ createdAt: -1 });
  let ticketCode = "IT-01";
  if (lastTicket && lastTicket.ticketCode) {
    const lastCode = parseInt(lastTicket.ticketCode.split("-")[1], 10);
    const nextCode = (lastCode + 1).toString().padStart(2, "0");
    ticketCode = `IT-${nextCode}`;
  }

  // 3) Tìm user technical ít ticket nhất (từ DB local)
  // Prefer Frappe role 'IT Helpdesk' to decide assignee list
  const technicalUsers = await getUsersByFrappeRole('IT Helpdesk', bearerToken);
  if (!technicalUsers || technicalUsers.length === 0) {
    throw new Error("Không tìm thấy user có Frappe Role 'IT Helpdesk' để gán (local/remote). Vui lòng kiểm tra đồng bộ roles hoặc cấu hình token.");
  }
  if (!technicalUsers.length) {
    throw new Error("Không tìm thấy user có Frappe Role 'IT Helpdesk' để gán!");
  }
    // Prefer active users first when selecting assignee
    const sortedByActive = [...technicalUsers].sort((a,b) => {
      const aActive = a.disabled ? 0 : 1;
      const bActive = b.disabled ? 0 : 1;
      return bActive - aActive;
    });
    const userTicketCounts = await Promise.all(
      sortedByActive.map(async (u) => {
        const count = await Ticket.countDocuments({ assignedTo: u._id });
        return { user: u, count };
      })
    );
  userTicketCounts.sort((a, b) => a.count - b.count);
  const leastAssignedUser = userTicketCounts[0].user;

  // 4) Tạo attachments
  const attachments = files.map((file) => ({
    filename: file.originalname,
    url: `${file.filename}`,
  }));

  // 5) Tạo ticket
  // Ensure creator is a valid ObjectId string: map from email -> local user if needed
  let creatorObjectId = creatorId;
  try {
    const mongoose = require('mongoose');
    if (!creatorObjectId || !mongoose.Types.ObjectId.isValid(String(creatorObjectId))) {
      // Try resolve by email
      if (creatorId && typeof creatorId === 'string' && creatorId.includes('@')) {
        const creatorUser = await User.findOne({ email: creatorId });
        if (creatorUser) {
          creatorObjectId = creatorUser._id;
        }
      }
      // Fallback to current authenticated user
      if (!creatorObjectId && fallbackCreatorId) {
        creatorObjectId = fallbackCreatorId;
      }
    }
  } catch (_) {}

  const newTicket = new Ticket({
    ticketCode,
    title,
    description,
    priority,
    creator: creatorObjectId,
    sla: slaPhase1Deadline,
    assignedTo: leastAssignedUser._id,
    attachments,
    status: "Assigned",
    history: [
      {
        timestamp: new Date(),
        action: ` <strong>${(await (async()=>{try{const u=await User.findById(creatorObjectId).lean();return u?.fullname||u?.email||creatorId;}catch(_){return creatorId;}})())}</strong> đã tạo ticket và chỉ định cho <strong>${leastAssignedUser.fullname}</strong>`,
        user: creatorObjectId,
      },
    ],
  });

  await newTicket.save();
  
  return newTicket;
}

// Tạo group chat cho ticket theo yêu cầu
exports.createTicketGroupChat = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    // Tìm ticket
    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Kiểm tra quyền tạo group chat
    const hasPermission = ticket.creator.equals(userId) || 
                         (ticket.assignedTo && ticket.assignedTo.equals(userId)) ||
                         req.user.role === "admin" || 
                         req.user.role === "superadmin";

    if (!hasPermission) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền tạo group chat cho ticket này" });
    }

    // Kiểm tra xem đã có group chat chưa (gọi chat-service xác minh)
    if (ticket.groupChatId) {
      const CHAT_BASE = process.env.CHAT_SERVICE_PUBLIC_URL || FRAPPE_API_URL;
      try {
        const checkResp = await axios.get(`${CHAT_BASE}/api/chats/${ticket.groupChatId}`, {
          headers: { Authorization: req.headers['authorization'] || '', 'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '' }
        });
        const existingChat = checkResp.data;
        // Đảm bảo current user trong participants nếu là creator/assignedTo
        const isUserInChat = Array.isArray(existingChat.participants) && existingChat.participants.some(p => (p._id || p).toString() === userId.toString());
        const isCreatorOrAssigned = ticket.creator._id.equals(userId) || (ticket.assignedTo && ticket.assignedTo._id.equals(userId));
        if (!isUserInChat && isCreatorOrAssigned) {
          try {
            await axios.post(`${CHAT_BASE}/api/chats/${ticket.groupChatId}/add-user`, { user_id: userId }, { headers: { Authorization: req.headers['authorization'] || '' } });
            // Re-fetch chat
        const refetch = await axios.get(`${CHAT_BASE}/api/chats/${ticket.groupChatId}`, { headers: { Authorization: req.headers['authorization'] || '', 'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '' } });
            return res.status(200).json({ success: true, message: 'Group chat đã tồn tại', groupChat: refetch.data });
          } catch (_) {
            // Ignore add failure, still return existing chat
          }
        }
        return res.status(200).json({ success: true, message: 'Group chat đã tồn tại', groupChat: existingChat });
      } catch (e) {
        // Not found -> clear and create new
        console.log(`⚠️ Ticket ${ticket.ticketCode} groupChatId không hợp lệ, sẽ tạo mới`);
        ticket.groupChatId = null;
      }
    }

    // Tìm admin ít group chat nhất để chia đều
    const adminUsers = await getAdminUsers();
    let selectedAdmin = null;
    
    if (adminUsers.length > 0) {
      const adminChatCounts = await Promise.all(
        adminUsers.map(async (admin) => {
          const count = await Chat.countDocuments({ 
            participants: admin.name,
            isGroup: true
          });
          return { admin, count };
        })
      );
      
      // Chọn admin có ít group chat nhất
      adminChatCounts.sort((a, b) => a.count - b.count);
      selectedAdmin = adminChatCounts[0].admin;
    }
    
    // Tạo danh sách participants cho group chat
    const participantIds = new Set();
    
    // Luôn thêm creator và assignedTo
    participantIds.add(ticket.creator._id.toString());
    if (ticket.assignedTo) {
      participantIds.add(ticket.assignedTo._id.toString());
    }
    
    // Thêm admin nếu có
    if (selectedAdmin) {
      participantIds.add(selectedAdmin._id.toString());
    }
    
    // Chỉ thêm currentUser nếu họ là creator hoặc assignedTo
    // Không thêm superadmin/admin khác vào ban đầu
    const isCreatorOrAssigned = ticket.creator.equals(userId) || 
                               (ticket.assignedTo && ticket.assignedTo.equals(userId));
    
    if (isCreatorOrAssigned) {
      participantIds.add(userId.toString()); // Đã có rồi nhưng Set sẽ tự loại bỏ duplicate
    }
    
    // Convert Set back to array of strings (Frappe user names)
    const participants = Array.from(participantIds).map(id => new mongoose.Types.ObjectId(id));
    
    console.log(`📝 Creating group chat participants:`, {
      creator: ticket.creator._id,
      assignedTo: ticket.assignedTo._id,
      selectedAdmin: selectedAdmin?._id,
      currentUser: userId,
      isCreatorOrAssigned,
      participantIds: Array.from(participantIds),
      finalParticipants: participants
    });
    
    // Tạo group chat qua chat-service
    const CHAT_BASE = process.env.CHAT_SERVICE_URL || process.env.CHAT_SERVICE_PUBLIC_URL || FRAPPE_API_URL;
    const createResp = await axios.post(`${CHAT_BASE}/api/chats/group`, {
      name: `Ticket: ${ticket.ticketCode}`,
      description: `Group chat tự động cho ticket ${ticket.ticketCode}`,
      participant_ids: participants.map((p) => p.toString()),
    }, {
      headers: {
        Authorization: req.headers['authorization'] || '',
        'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || ''
      }
    });

    const groupChat = createResp.data?.message || createResp.data; // support both shapes
    if (!groupChat || !groupChat._id) {
      throw new Error('Không thể tạo group chat qua chat-service');
    }

    console.log(`✅ Đã tạo group chat ${groupChat._id} (chat-service) cho ticket ${ticket.ticketCode} với ${participants.length} participants`);

    // Lưu group chat ID vào ticket
    ticket.groupChatId = groupChat._id;
    
    // Ghi log tạo group chat
    const isCreatorOrAssignedUser = ticket.creator._id.equals(userId) || 
                                   (ticket.assignedTo && ticket.assignedTo._id.equals(userId));
    
    let logMessage = ` <strong>${req.user.fullname}</strong> đã tạo group chat cho ticket`;
    if (!isCreatorOrAssignedUser) {
      logMessage += ` (với ${participants.length} thành viên ban đầu)`;
    }
    
    ticket.history.push({
      timestamp: new Date(),
      action: logMessage,
      user: userId,
    });
    
    await ticket.save();
    
    // Trả về dữ liệu chat từ chat-service
    const refetch = await axios.get(`${CHAT_BASE}/api/chats/${groupChat._id}`, { headers: { Authorization: req.headers['authorization'] || '', 'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '' } });
    const finalChat = refetch.data || groupChat;

    res.status(201).json({
      success: true,
      message: "Tạo group chat thành công",
      groupChat: finalChat,
      participantsCount: Array.isArray(finalChat.participants) ? finalChat.participants.length : undefined,
      isCurrentUserInChat: Array.isArray(finalChat.participants) ? finalChat.participants.some(p => (p._id || p).toString() === userId.toString()) : true
    });
    
  } catch (error) {
    console.error('Lỗi khi tạo group chat cho ticket:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createTicketHelper = createTicketHelper;

// Tham gia group chat của ticket (cho admin/superadmin)
exports.joinTicketGroupChat = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    // Tìm ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Kiểm tra quyền tham gia (chỉ admin/superadmin hoặc người có liên quan đến ticket)
    const canJoin = ticket.creator.equals(userId) || 
                   (ticket.assignedTo && ticket.assignedTo.equals(userId)) ||
                   req.user.role === "admin" || 
                   req.user.role === "superadmin";

    if (!canJoin) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền tham gia group chat này" });
    }

    // Kiểm tra group chat tồn tại
    if (!ticket.groupChatId) {
      return res.status(404).json({ success: false, message: "Ticket chưa có group chat" });
    }

    const CHAT_BASE = process.env.CHAT_SERVICE_URL || process.env.CHAT_SERVICE_PUBLIC_URL || FRAPPE_API_URL;
    // Kiểm tra đã là participant?
    try {
      const current = await axios.get(`${CHAT_BASE}/api/chats/${ticket.groupChatId}`, { headers: { Authorization: req.headers['authorization'] || '', 'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '' } });
      const currentChat = current.data;
      const isAlreadyParticipant = Array.isArray(currentChat.participants) && currentChat.participants.some(p => (p._id || p).toString() === userId.toString());
      if (!isAlreadyParticipant) {
            await axios.post(`${CHAT_BASE}/api/chats/${ticket.groupChatId}/add-user`, { user_id: userId }, { headers: { Authorization: req.headers['authorization'] || '', 'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '' } });
      }
    } catch (e) {
      if (e.response?.status === 404) {
        return res.status(404).json({ success: false, message: 'Group chat không tồn tại' });
      }
      throw e;
    }

    // Ghi log vào ticket history
    ticket.history.push({
      timestamp: new Date(),
      action: ` <strong>${req.user.fullname} (${req.user.role})</strong> đã tham gia group chat`,
      user: userId,
    });
    await ticket.save();

    // Lấy lại thông tin chat từ chat-service để trả về
    const updated = await axios.get(`${CHAT_BASE}/api/chats/${ticket.groupChatId}`, { headers: { Authorization: req.headers['authorization'] || '', 'X-Service-Token': process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '' } });
    const updatedGroupChat = updated.data;

    res.status(200).json({
      success: true,
      message: "Tham gia group chat thành công",
      groupChat: updatedGroupChat,
      isParticipant: true,
    });
    
  } catch (error) {
    console.error('Lỗi khi tham gia group chat:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};