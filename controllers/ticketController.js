const Ticket = require("../models/Ticket");
const SupportTeam = require("../models/SupportTeam");
const SupportTeamMember = require("../models/SupportTeamMember");
const notificationService = require('../services/notificationService');
const emailController = require('./emailController');
const { TICKET_LOGS, SUBTASK_LOGS, OTHER_LOGS, normalizeVietnameseName, translateStatus } = require('../utils/logFormatter');
const mongoose = require("mongoose");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Import User model for getTechnicalUsers
const User = require("../models/Users");

/**
 * Get technical users for ticket assignment
 * Returns users with technical/IT roles
 */
async function getTechnicalUsers(token = null) {
  try {
    // For email tickets, prioritize users with "Email Ticket" role
    const emailTicketMembers = await SupportTeamMember.find({
      isActive: true,
      roles: { $in: ['Email Ticket'] }
    }).populate('userId').lean();

    if (emailTicketMembers.length > 0) {
      // Sort by ticket count (least assigned first)
      const sortedMembers = await Promise.all(
        emailTicketMembers.map(async (member) => {
          const ticketCount = await Ticket.countDocuments({ assignedTo: member._id });
          return { ...member, ticketCount };
        })
      );

      sortedMembers.sort((a, b) => a.ticketCount - b.ticketCount);

      return sortedMembers.map(member => ({
        _id: member._id,
        email: member.email,
        fullname: member.fullname,
        name: member.userId?.name || member.fullname,
        disabled: member.userId?.disabled || false
      }));
    }

    // Fallback: get from SupportTeamMember collection (other technical roles)
    const supportMembers = await SupportTeamMember.find({
      isActive: true,
      roles: { $in: ['Overall', 'Software', 'Network', 'Camera System', 'Bell System'] }
    }).populate('userId').lean();

    if (supportMembers.length > 0) {
      // Sort by ticket count (least assigned first)
      const sortedMembers = await Promise.all(
        supportMembers.map(async (member) => {
          const ticketCount = await Ticket.countDocuments({ assignedTo: member._id });
          return { ...member, ticketCount };
        })
      );

      sortedMembers.sort((a, b) => a.ticketCount - b.ticketCount);

      return sortedMembers.map(member => ({
        _id: member._id,
        email: member.email,
        fullname: member.fullname,
        name: member.userId?.name || member.fullname,
        disabled: member.userId?.disabled || false
      }));
    }

    // Final fallback: get users with technical roles from User collection
    const technicalUsers = await User.find({
      active: true,
      disabled: { $ne: true },
      $or: [
        { role: { $in: ['technical', 'superadmin'] } },
        { roles: { $in: ['SIS IT', 'IT Helpdesk', 'System Manager'] } }
      ]
    }).lean();

    return technicalUsers.map(user => ({
      _id: user._id,
      email: user.email,
      fullname: user.fullname,
      name: user.fullname,
      disabled: user.disabled
    }));

  } catch (error) {
    console.error('❌ Error getting technical users:', error);
    return [];
  }
}

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';

// Helper function to build full file URL after FRAPPE_API_URL constant
function buildFullFileUrl(relativePath) {
  return `${FRAPPE_API_URL}${relativePath}`;
}

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

// Helper function to get admin users from Frappe
async function getAdminUsers() {
  try {
    // Query Frappe for admin users
    // This is a placeholder - adjust based on your Frappe user roles
    return [];
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

// Helper function to get user avatar URL from Frappe
async function getUserAvatarFromFrappe(userEmail, frappeToken = null) {
  try {
    // Build headers - prefer JWT token from request, fallback to API key/secret
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // Use JWT token from request if available
    if (frappeToken) {
      headers['Authorization'] = `Bearer ${frappeToken}`;
      headers['X-Frappe-CSRF-Token'] = frappeToken;
    } else {
      // Fallback to API key/secret (if configured)
      if (process.env.FRAPPE_API_KEY && 
          process.env.FRAPPE_API_KEY !== 'your_frappe_api_key' &&
          process.env.FRAPPE_API_SECRET &&
          process.env.FRAPPE_API_SECRET !== 'your_frappe_api_secret') {
        headers['Authorization'] = `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`;
      } else {
        console.debug(`Skipping Frappe avatar fetch - no valid token or credentials for user ${userEmail}`);
        return '';
      }
    }
    
    const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${userEmail}`, {
      params: {
        fields: JSON.stringify(['user_image', 'name', 'email'])
      },
      headers,
      timeout: 3000 // 3 second timeout to avoid hanging
    });
    
    if (response.data?.data?.user_image) {
      return response.data.data.user_image;
    }
    return '';
  } catch (error) {
    console.debug(`Note: Could not fetch avatar from Frappe for ${userEmail}: ${error.message}`);
    return '';
  }
}

// Simple in-memory cache for avatar URLs (reset on server restart)
const avatarCache = new Map();

// Helper function to enrich ticket with user avatars from Frappe
async function enrichTicketWithAvatars(ticket, frappeToken = null) {
  if (!ticket) return ticket;
  
  try {
    // Fetch avatar for creator if missing or empty
    if (ticket.creator && ticket.creator.email && (!ticket.creator.avatarUrl || ticket.creator.avatarUrl === '')) {
      let creatorAvatar = avatarCache.get(ticket.creator.email);
      if (creatorAvatar === undefined) {
        creatorAvatar = await getUserAvatarFromFrappe(ticket.creator.email, frappeToken);
        avatarCache.set(ticket.creator.email, creatorAvatar || '');
      }
      if (creatorAvatar) {
        ticket.creator.avatarUrl = creatorAvatar;
      }
    }
    
    // Fetch avatar for assignedTo if missing or empty
    if (ticket.assignedTo && ticket.assignedTo.email && (!ticket.assignedTo.avatarUrl || ticket.assignedTo.avatarUrl === '')) {
      let assignedToAvatar = avatarCache.get(ticket.assignedTo.email);
      if (assignedToAvatar === undefined) {
        assignedToAvatar = await getUserAvatarFromFrappe(ticket.assignedTo.email, frappeToken);
        avatarCache.set(ticket.assignedTo.email, assignedToAvatar || '');
      }
      if (assignedToAvatar) {
        ticket.assignedTo.avatarUrl = assignedToAvatar;
      }
    }
  } catch (error) {
    console.debug('Note: Error enriching ticket with avatars:', error.message);
  }
  
  return ticket;
}

/**
 * Ticket Category Mapping (EN -> VI)
 */
const TICKET_CATEGORY_LABELS = {
  'Overall': 'Vấn đề chung',
  'Camera': 'Hệ thống camera',
  'Network': 'Hệ thống mạng',
  'Bell System': 'Hệ thống chuông báo',
  'Software': 'Hệ thống phần mềm',
  'Account': 'Tài khoản'
};

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
  const options = {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };
  const formatted = new Intl.DateTimeFormat("vi-VN", options).format(now);
  return `${formatted}`;
}



// a) Tạo ticket
exports.createTicket = async (req, res) => {
  try {
    console.log('🎫 [createTicket] Starting ticket creation...');
    console.log('   Body:', JSON.stringify(req.body, null, 2));

    const { title, description, category, notes } = req.body;
    const userId = req.user._id;

    // Validation
    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: 'Tiêu đề không được để trống' });
    }
    if (!description?.trim()) {
      return res.status(400).json({ success: false, message: 'Mô tả chi tiết không được để trống' });
    }
    if (!category) {
      return res.status(400).json({ success: false, message: 'Hạng mục không được để trống' });
    }

    // Import helper functions
    const { generateTicketCode, assignTicketToUser, logTicketHistory } = require('../utils/ticketHelper');

    // 1️⃣ Generate ticket code
    const ticketCode = await generateTicketCode(category);
    console.log(`   Generated code: ${ticketCode}`);

    // 2️⃣ Auto-assign to team member with matching role
    const assignedToId = await assignTicketToUser(category);
    console.log(`   Assigned to: ${assignedToId || 'None'}`);

    // 3️⃣ Create ticket
    console.log(`🔧 [createTicket] Creating ticket with:`);
    console.log(`   assignedToId: ${assignedToId}`);
    console.log(`   assignedToId type: ${typeof assignedToId}`);
    console.log(`   assignedToId || undefined: ${assignedToId || 'undefined'}`);
    
    const newTicket = new Ticket({
      ticketCode,
      title: title.trim(),
      description: description.trim(),
      category,
      creator: userId,
      assignedTo: assignedToId || undefined,
      priority: 'Medium', // Default priority
      status: 'Assigned',
      notes: notes?.trim() || '',
      attachments: req.files ? req.files.map(file => ({
        filename: file.originalname,
        url: file.path || file.filename
      })) : []
    });

    console.log(`🔧 [createTicket] After new Ticket():`);
    console.log(`   newTicket.assignedTo: ${newTicket.assignedTo}`);
    console.log(`   newTicket.assignedTo type: ${typeof newTicket.assignedTo}`);
    
    await newTicket.save();
    console.log(`✅ [createTicket] Ticket created: ${newTicket._id}`);
    // 3️⃣ Move uploaded files from temp folder to ticket folder if any
    if (req.files && req.files.length > 0) {
      const tempFolder = 'uploads/Tickets/temp';
      const ticketFolder = `uploads/Tickets/${newTicket.ticketCode}`;
      
      // Create ticket folder if it doesn't exist
      if (!fs.existsSync(ticketFolder)) {
        fs.mkdirSync(ticketFolder, { recursive: true });
      }
      
      console.log(`   📁 Moving files to: ${ticketFolder}`);
      
      // Move each file from temp to ticket folder
      for (const file of req.files) {
        const oldPath = file.path;
        const newPath = path.join(ticketFolder, file.filename);
        
        try {
          fs.renameSync(oldPath, newPath);
          console.log(`   📁 Moved: ${file.filename}`);
          
          // Update attachment URL in database
          const attachmentIndex = newTicket.attachments.findIndex(a => a.url.includes(file.filename));
          if (attachmentIndex !== -1) {
            newTicket.attachments[attachmentIndex].url = buildFullFileUrl(`/${newPath}`);
          }
        } catch (moveError) {
          console.error(`   ⚠️  Error moving file ${file.filename}:`, moveError.message);
        }
      }
      
      // Save updated ticket with new file paths
      await newTicket.save();
      console.log(`   ✅ All files moved successfully`);
    }
    
    console.log(`🔧 [createTicket] After save():`);
    console.log(`   newTicket.assignedTo: ${newTicket.assignedTo}`);

    // 4️⃣ Log history
    const creatorName = req.user.fullname || req.user.email;
    console.log(`📝 [createTicket] Creator name: "${creatorName}"`);

    // Log ticket creation
    await logTicketHistory(
      newTicket._id,
      TICKET_LOGS.TICKET_CREATED(creatorName), // LOG sẽ tự normalize
      userId
    );

    if (assignedToId) {
      // Get assigned user info for history log
      const SupportTeamMember = require('../models/SupportTeamMember');
      const assignedMember = await SupportTeamMember.findById(assignedToId).select('fullname');
      const assignedName = assignedMember?.fullname || 'Unknown';
      console.log(`📝 [createTicket] Assigned name: "${assignedName}"`);

      // Log auto assignment
      await logTicketHistory(
        newTicket._id,
        TICKET_LOGS.AUTO_ASSIGNED(assignedName), // LOG sẽ tự normalize
        userId
      );
    }

    // 5️⃣ Send notification
    try {
      await notificationService.sendNewTicketNotification(newTicket);
    } catch (notifyError) {
      console.warn('⚠️  Error sending notification:', notifyError.message);
    }

    // Populate creator and assignedTo for response
    console.log(`🔧 [createTicket] Before populate - assignedTo: ${newTicket.assignedTo}`);
    
    if (newTicket.assignedTo) {
      // Check if assignedTo user exists in SupportTeamMember
      const SupportTeamMember = require('../models/SupportTeamMember');
      const member = await SupportTeamMember.findById(newTicket.assignedTo);
      console.log(`🔧 [createTicket] assignedTo user exists: ${member ? 'YES' : 'NO'}`);
    }
    
    await newTicket.populate('creator assignedTo', 'fullname email avatarUrl');

    console.log(`📋 [createTicket] Before response:`);
    console.log(`   assignedTo field: ${JSON.stringify(newTicket.assignedTo)}`);
    console.log(`   creator field: ${JSON.stringify(newTicket.creator)}`);

    // Gửi thông báo cho support team
    try {
      await notificationService.sendNewTicketNotification(newTicket);
      console.log(`📢 [createTicket] Sent notifications for new ticket: ${newTicket.ticketCode}`);
    } catch (notificationError) {
      console.warn(`⚠️  [createTicket] Failed to send notifications:`, notificationError.message);
    }

    // Gửi email thông báo cho support team (nếu được bật)
    try {
      await emailController.sendNewTicketNotification(newTicket);
      console.log(`📧 [createTicket] Sent email notifications for new ticket: ${newTicket.ticketCode}`);
    } catch (emailError) {
      console.warn(`⚠️  [createTicket] Failed to send email notifications:`, emailError.message);
    }

    res.status(201).json({
      success: true,
      data: {
        _id: newTicket._id,
        ticketCode: newTicket.ticketCode,
        title: newTicket.title,
        description: newTicket.description,
        category: newTicket.category,
        status: newTicket.status,
        priority: newTicket.priority,
        creator: newTicket.creator,
        assignedTo: newTicket.assignedTo,
        notes: newTicket.notes,
        createdAt: newTicket.createdAt,
        updatedAt: newTicket.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error in createTicket:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// a) Lấy danh sách ticket
exports.getTickets = async (req, res) => {
  console.log("🔵 Kiểm tra req.user:", req.user);

  const { status, priority, userTickets, creator, search } = req.query;
  const userId = req.user._id;

  console.log("Query parameters:", { status, priority, userTickets, creator, search });

  try {
    let query = {};

    if (creator) {
      query.creator = creator;
      console.log("🔍 Filtering by creator:", creator);
    }
    else if (userTickets) {
      query = { $or: [{ creator: userTickets }, { assignedTo: userTickets }] };
    } else {
      if (req.user.role === "superadmin") {
        query = {};
      } else {
        query = { $or: [{ creator: userId }, { assignedTo: userId }] };
      }
    }

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
      query.status = status;
    }
    if (priority) query.priority = priority;

    console.log("Final query:", JSON.stringify(query, null, 2));

    const tickets = await Ticket.find(query)
      .sort({ createdAt: -1 })
      .populate("creator assignedTo");

    console.log("Found tickets:", tickets.length);

    // Enrich tickets with avatars from Frappe using JWT token from request
    const frappeToken = req.headers.authorization?.replace('Bearer ', '') || null;
    for (const ticket of tickets) {
      await enrichTicketWithAvatars(ticket, frappeToken);
    }

    res.status(200).json({ success: true, tickets });
  } catch (error) {
    console.error("Error in getTickets:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// b) Lấy danh sách ticket của user đang đăng nhập (creator = req.user)
exports.getMyTickets = async (req, res) => {
  try {
    console.log('🎫 [getMyTickets] Fetching tickets for user:', req.user.email);
    
    const userId = req.user._id;
    
    // Lấy ticket nơi user là creator
    const tickets = await Ticket.find({ creator: userId })
      .sort({ createdAt: -1 })
      .select('_id title description ticketCode status creator assignedTo priority category createdAt updatedAt')
      .populate({
        path: 'creator',
        select: 'fullname email avatarUrl'
      })
      .populate({
        path: 'assignedTo',
        select: 'fullname email avatarUrl'
      });
    
    console.log(`✅ [getMyTickets] Found ${tickets.length} tickets for user ${req.user.email}`);
    
    // Enrich tickets with avatars from Frappe using JWT token from request
    const frappeToken = req.headers.authorization?.replace('Bearer ', '') || null;
    for (const ticket of tickets) {
      await enrichTicketWithAvatars(ticket, frappeToken);
    }
    
    // Format tickets cho frontend
    const formattedTickets = tickets.map(ticket => ({
      _id: ticket._id,
      title: ticket.title,
      description: ticket.description,
      ticketCode: ticket.ticketCode,
      status: ticket.status || 'Assigned',
      creator: ticket.creator,
      creatorEmail: req.user.email,
      assignedTo: ticket.assignedTo || null,
      priority: ticket.priority || 'Normal',
      category: ticket.category || 'General',
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt
    }));
    
    res.status(200).json({
      success: true,
      data: {
        tickets: formattedTickets
      }
    });
  } catch (error) {
    console.error('❌ Error in getMyTickets:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Lấy ticket by ID
exports.getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.ticketId)
      .populate("creator assignedTo")
      .populate({
        path: "messages.sender",
        model: "User",
        select: "fullname avatarUrl email",
      })
      .populate({
        path: "subTasks.assignedTo",
        model: "User",
        select: "fullname email avatarUrl",
      });

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Enrich ticket with avatars from Frappe if missing
    // Use JWT token from request headers or localStorage (already in req.headers.authorization)
    const frappeToken = req.headers.authorization?.replace('Bearer ', '') || null;
    await enrichTicketWithAvatars(ticket, frappeToken);

    return res.status(200).json({ 
      success: true, 
      data: ticket 
    });
  } catch (error) {
    console.error("❌ Error in getTicketById:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 📋 Lấy lịch sử ticket
exports.getTicketHistory = async (req, res) => {
  try {
    const { ticketId } = req.params;

    console.log(`📋 [getTicketHistory] Fetching history for ticket: ${ticketId}`);

    // Lấy ticket và populate history với thông tin user
    const ticket = await Ticket.findById(ticketId)
      .populate({
        path: 'history.user',
        model: 'User',
        select: 'fullname email avatarUrl'
      })
      .select('history');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket không tồn tại"
      });
    }

    // Sort history theo thời gian mới nhất trước
    // Action đã được normalize từ logFormatter khi tạo, chỉ cần normalize user.fullname
    const sortedHistory = ticket.history
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map(entry => ({
        _id: entry._id,
        timestamp: entry.timestamp,
        action: entry.action, // Action đã được format sẵn từ logFormatter với tên đã normalize
        user: entry.user ? {
          _id: entry.user._id,
          email: entry.user.email,
          avatarUrl: entry.user.avatarUrl,
          fullname: normalizeVietnameseName(entry.user.fullname) // Normalize tên user để đồng nhất
        } : null
      }));

    console.log(`✅ [getTicketHistory] Found ${sortedHistory.length} history entries for ticket ${ticketId}`);

    return res.status(200).json({
      success: true,
      data: sortedHistory
    });

  } catch (error) {
    console.error("❌ Error in getTicketHistory:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// c) Cập nhật ticket
exports.updateTicket = async (req, res) => {
  const { ticketId } = req.params;
  const updates = req.body;
  const userId = req.user._id;

  try {
    console.log('📝 [updateTicket] Updating ticket:', ticketId);
    console.log('   Updates:', JSON.stringify(updates, null, 2));
    // Handle file attachments if provided
    if (req.files && req.files.length > 0) {
      console.log(`   Files: ${req.files.length} file(s)`);
      updates.attachments = req.files.map(file => ({
        filename: file.originalname,
        url: file.path || file.filename
      }));
    }

    const ticket = await Ticket.findById(ticketId)
      .populate('creator assignedTo');

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Check permission: only creator or assignedTo can update
    if (!ticket.creator.equals(userId) && (!ticket.assignedTo || !ticket.assignedTo.equals(userId)) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: "Bạn không có quyền chỉnh sửa ticket này" });
    }

    const previousStatus = ticket.status;

    // 📝 Log status change
    if (updates.status && updates.status !== ticket.status) {
      const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
      ticket.history.push({
        timestamp: new Date(),
        action: TICKET_LOGS.STATUS_CHANGED(previousStatus, updates.status, userName),
        user: userId
      });

      // Set acceptedAt khi status chuyển sang "Processing"
      if (updates.status === "Processing" && !ticket.acceptedAt) {
        ticket.acceptedAt = new Date();
      }

      // Set closedAt khi status chuyển sang "Closed" hoặc "Done"
      if ((updates.status === "Closed" || updates.status === "Done") && !ticket.closedAt) {
        ticket.closedAt = new Date();
      }
    }

    // 📝 Log other field changes
    if (updates.title && updates.title !== ticket.title) {
      const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
      ticket.history.push({
        timestamp: new Date(),
        action: OTHER_LOGS.FIELD_UPDATED('tiêu đề', userName),
        user: userId
      });
    }

    if (updates.description && updates.description !== ticket.description) {
      const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
      ticket.history.push({
        timestamp: new Date(),
        action: OTHER_LOGS.FIELD_UPDATED('mô tả', userName),
        user: userId
      });
    }

    // Update fields
    Object.assign(ticket, updates);
    ticket.updatedAt = new Date();

    await ticket.save();
    console.log(`✅ [updateTicket] Ticket updated: ${ticketId}`);

    // Populate for response
    await ticket.populate('creator assignedTo', 'fullname email avatarUrl');

    res.status(200).json({
      success: true,
      data: {
        _id: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        status: ticket.status,
        priority: ticket.priority,
        creator: ticket.creator,
        assignedTo: ticket.assignedTo,
        notes: ticket.notes,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        acceptedAt: ticket.acceptedAt,
        closedAt: ticket.closedAt
      }
    });
  } catch (error) {
    console.error('❌ Error in updateTicket:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Xóa ticket (soft delete - chỉ set status = Cancelled)
 */
exports.deleteTicket = async (req, res) => {
  const { ticketId } = req.params;
  const userId = req.user._id;

  try {
    console.log('🗑️  [deleteTicket] Deleting ticket:', ticketId);

    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    // Check permission: only creator can delete
    if (!ticket.creator.equals(userId) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: "Bạn không có quyền xóa ticket này" });
    }

    // Soft delete: set status to Cancelled
    ticket.status = 'Cancelled';
    ticket.cancellationReason = 'Deleted by creator';
    ticket.updatedAt = new Date();

    // Log history
    const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.TICKET_CANCELLED(userName),
      user: userId
    });

    await ticket.save();
    console.log(`✅ [deleteTicket] Ticket cancelled: ${ticketId}`);

    res.status(200).json({
      success: true,
      message: 'Ticket đã được xóa'
    });
  } catch (error) {
    console.error('❌ Error in deleteTicket:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// d) Thêm phản hồi
exports.addFeedback = async (req, res) => {
  const { ticketId } = req.params;
  const { rating, comment, badges } = req.body;

  try {
    const ticket = await Ticket.findById(ticketId);

    const hasPreviousRating = !!ticket.feedback?.rating;

    if (!hasPreviousRating) {
      if (!rating) {
        return res.status(400).json({
          success: false,
          message: "Bạn phải chọn số sao để đánh giá.",
        });
      }

      ticket.feedback = {
        assignedTo: ticket.assignedTo,
        rating,
        comment: comment || "",
        badges: badges || [],
      };

    } else {
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
    }

    await ticket.save();

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
    const { userId } = req.params;

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

    const totalFeedbacks = tickets.length;
    const sumRating = tickets.reduce((sum, t) => sum + t.feedback.rating, 0);
    const averageRating = sumRating / totalFeedbacks;

    const badgesCount = {};
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
      action: OTHER_LOGS.TICKET_ESCALATED(req.user.fullname, ticket.escalateLevel), // LOG sẽ tự normalize
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
      action: OTHER_LOGS.SLA_BREACH(ticket.escalateLevel),
    });

    await ticket.save();
  });

  console.log(`${tickets.length} tickets escalated due to SLA breach.`);
};

// Gửi tin nhắn trong ticket
exports.sendMessage = async (req, res) => {
  const { ticketId } = req.params;
  const { text } = req.body;

  try {
    const ticket = await Ticket.findById(ticketId).populate("creator assignedTo");
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    const isParticipant =
      ticket.creator.equals(req.user._id) ||
      (ticket.assignedTo && ticket.assignedTo.equals(req.user._id));

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền chat trong ticket này",
      });
    }

    // Kiểm tra xem người gửi có phải là support team member không
    const isSupportTeamMember = await SupportTeamMember.findOne({
      userId: req.user.email || req.user.userId,
      isActive: true
    });

    let oldStatus = ticket.status;
    let newStatus = oldStatus;
    let statusChanged = false;

    // Logic thay đổi trạng thái dựa trên người gửi
    if (isSupportTeamMember) {
      // Support team member gửi comment -> chuyển sang "Waiting for Customer"
      if (ticket.status === "Processing") {
        newStatus = "Waiting for Customer";
        statusChanged = true;
      }
    } else {
      // User thường gửi comment -> chuyển về "Processing"
      if (ticket.status === "Waiting for Customer") {
        newStatus = "Processing";
        statusChanged = true;
      }
    }

    if (req.file) {
      const filePath = `/uploads/Messages/${req.file.filename}`;
      ticket.messages.push({
        sender: req.user._id,
        text: filePath,
        timestamp: new Date(),
        type: "image",
      });
    } else {
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

    // Cập nhật trạng thái nếu có thay đổi
    if (statusChanged) {
      ticket.status = newStatus;
      ticket.updatedAt = new Date();

      // Thêm history log
      const statusChangeMessage = isSupportTeamMember
        ? `Support team đã gửi bình luận - trạng thái thay đổi từ "${translateStatus(oldStatus)}" sang "${translateStatus(newStatus)}"`
        : `Người dùng đã phản hồi - trạng thái thay đổi từ "${translateStatus(oldStatus)}" sang "${translateStatus(newStatus)}"`;

      ticket.history.push({
        timestamp: new Date(),
        action: statusChangeMessage,
        user: req.user._id,
      });
    }

    await ticket.save();
    const updatedTicket = await Ticket.findById(ticketId)
      .populate("creator assignedTo")
      .populate({
        path: "messages.sender",
        model: "User",
        select: "fullname avatarUrl email",
      });

    // Process the last message to ensure avatar URL
    const lastMessage = updatedTicket.messages[updatedTicket.messages.length - 1];
    let processedLastMessage = lastMessage.toObject ? lastMessage.toObject() : lastMessage;

    // Ensure avatar URL is processed
    if (processedLastMessage.sender?.avatarUrl && processedLastMessage.sender.avatarUrl.startsWith('/files/')) {
      processedLastMessage.sender.avatarUrl = `${FRAPPE_API_URL}${processedLastMessage.sender.avatarUrl}`;
    }

    const io = req.app.get("io");

    const messageData = {
      _id: processedLastMessage._id,
      text: processedLastMessage.text,
      sender: processedLastMessage.sender,
      timestamp: processedLastMessage.timestamp,
      type: processedLastMessage.type,
      ticketId: ticketId,
      tempId: req.body.tempId || null,
    };

    // Emit to all clients in ticket room
    io.to(`ticket:${ticketId}`).emit("newMessage", messageData);
    // Backward compatibility
    io.to(ticketId).emit("newMessage", messageData);

    await notificationService.sendTicketUpdateNotification(ticket, 'comment_added', req.user._id);

    return res.status(200).json({
      success: true,
      message: statusChanged
        ? "Tin nhắn đã được gửi và trạng thái ticket đã được cập nhật"
        : "Tin nhắn đã được gửi thành công",
      messageData: processedLastMessage,
      ticket: updatedTicket,
      statusChanged: statusChanged,
      oldStatus: oldStatus,
      newStatus: newStatus,
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

    let assignedUser = null;
    // Find user from Frappe
    try {
      const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User?filters=[["full_name","=","${assignedTo}"]]`, {
        headers: {
          'Authorization': req.headers.authorization,
          'X-Frappe-CSRF-Token': req.headers.authorization?.replace('Bearer ', '')
        }
      });
      if (response.data.data && response.data.data.length > 0) {
        assignedUser = response.data.data[0];
      }
    } catch (error) {
      console.error('Error finding user by fullname:', error);
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

    // Helper function to reverse name parts (reuse from assignTicketToMe if available, or define locally)
    const reverseName = (fullname) => {
      if (!fullname) return fullname;
      const parts = fullname.trim().split(' ');
      if (parts.length <= 1) return fullname;
      const firstName = parts[0];
      const rest = parts.slice(1);
      return rest.join(' ') + ' ' + firstName;
    };

    ticket.history.push({
      timestamp: new Date(),
      action: SUBTASK_LOGS.SUBTASK_CREATED(req.user.fullname, title, finalStatus), // LOG sẽ tự normalize
      user: req.user._id,
    });

    await ticket.save();

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

    if (subTask.status !== status) {
      ticket.history.push({
        timestamp: new Date(),
        action: SUBTASK_LOGS.SUBTASK_STATUS_CHANGED(
          req.user.fullname, // LOG sẽ tự normalize
          subTask.title,
          translateStatus(subTask.status),
          translateStatus(status)
        ),
        user: req.user._id,
      });
    }

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

    ticket.history.push({
      timestamp: new Date(),
      action: SUBTASK_LOGS.SUBTASK_DELETED(req.user.fullname, subTask.title), // LOG sẽ tự normalize
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

    const ticket = await Ticket.findById(ticketId)
      .populate({
        path: 'messages.sender',
        model: 'User',
        select: 'fullname avatarUrl email',
      });

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

    // Process messages để đảm bảo có avatar URL
    const processedMessages = await Promise.all(
      (ticket.messages || []).map(async (message) => {
        const processedMessage = message.toObject ? message.toObject() : message;

        // Nếu không có avatar URL, thử lấy từ Frappe
        if (!processedMessage.sender?.avatarUrl && processedMessage.sender?.email) {
          try {
            console.log('🔍 Fetching avatar for user:', processedMessage.sender.email);

            // Thử nhiều cách khác nhau để authenticate
            const authHeaders = {};
            if (req.headers.authorization) {
              authHeaders['Authorization'] = req.headers.authorization;
            }
            if (req.headers['x-frappe-csrf-token']) {
              authHeaders['X-Frappe-CSRF-Token'] = req.headers['x-frappe-csrf-token'];
            }

            const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User?filters=[["email","=","${processedMessage.sender.email}"]]`, {
              headers: authHeaders,
              timeout: 5000 // 5 second timeout
            });

            console.log('📡 Frappe API response status:', response.status);
            console.log('📡 Frappe API response data:', JSON.stringify(response.data, null, 2));

            if (response.data.data && response.data.data.length > 0) {
              const frappeUser = response.data.data[0];
              console.log('👤 Frappe user data keys:', Object.keys(frappeUser));

              // Thử nhiều field names có thể chứa avatar
              const possibleAvatarFields = ['user_image', 'avatar_url', 'avatar', 'photo', 'user_photo', 'picture'];
              let avatarUrl = null;

              for (const field of possibleAvatarFields) {
                if (frappeUser[field]) {
                  avatarUrl = frappeUser[field];
                  console.log(`🖼️ Found avatar in field '${field}':`, avatarUrl);
                  break;
                }
              }

              // Update local user avatar if found
              if (avatarUrl) {
                const fullAvatarUrl = avatarUrl.startsWith('/files/') ? `${FRAPPE_API_URL}${avatarUrl}` : avatarUrl;
                console.log('💾 Updating local user avatar to:', fullAvatarUrl);

                await User.findByIdAndUpdate(processedMessage.sender._id, {
                  avatarUrl: fullAvatarUrl
                });
                processedMessage.sender.avatarUrl = fullAvatarUrl;
              } else {
                console.log('⚠️ No avatar fields found in Frappe user data');
              }
            } else {
              console.log('❌ No user found in Frappe for email:', processedMessage.sender.email);
            }
          } catch (error) {
            console.error('❌ Error fetching user avatar from Frappe:', error.message);
            if (error.response) {
              console.error('Response status:', error.response.status);
              console.error('Response data:', error.response.data);
            }
          }
        }

        // Đảm bảo avatar URL có full URL nếu là relative path
        if (processedMessage.sender?.avatarUrl && processedMessage.sender.avatarUrl.startsWith('/files/')) {
          processedMessage.sender.avatarUrl = `${FRAPPE_API_URL}${processedMessage.sender.avatarUrl}`;
        }

        return processedMessage;
      })
    );

    return res.status(200).json({
      success: true,
      messages: processedMessages,
    });
  } catch (error) {
    console.error('Error getting ticket messages:', error);
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

// Xoá user khỏi supportTeam
exports.removeUserFromSupportTeam = async (req, res) => {
  try {
    const { userId } = req.body;
    const message = await SupportTeam.removeMember(userId, req.user);
    res.status(200).json({ success: true, message });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Lấy danh sách hạng mục ticket (categories)
 * Trả về tất cả roles từ support team members
 */
exports.getTicketCategories = async (req, res) => {
  try {
    console.log('🔍 [getTicketCategories] Fetching ticket categories...');

    // Lấy unique roles từ Support Team members
    const SupportTeamMember = require('../models/SupportTeamMember');
    const teamMembers = await SupportTeamMember.find({ isActive: true }).select('roles');

    // Tập hợp tất cả unique roles
    const rolesSet = new Set();
    teamMembers.forEach(member => {
      if (Array.isArray(member.roles)) {
        member.roles.forEach(role => rolesSet.add(role));
      }
    });

    // Convert to categories format with Vietnamese labels
    const categories = Array.from(rolesSet).map(role => ({
      value: role,
      label: TICKET_CATEGORY_LABELS[role] || role // Use Vietnamese label or fallback to role name
    })).sort((a, b) => a.label.localeCompare(b.label, 'vi'));

    console.log(`✅ [getTicketCategories] Found ${categories.length} categories`);

    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('❌ Error in getTicketCategories:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * DEBUG: Kiểm tra team members và roles
 */
exports.debugTeamMembers = async (req, res) => {
  try {
    const SupportTeamMember = require('../models/SupportTeamMember');
    
    // Lấy tất cả team members active
    const allMembers = await SupportTeamMember.find({ isActive: true });
    
    console.log(`📊 [debugTeamMembers] Found ${allMembers.length} active team members`);
    
    // Group by roles
    const membersByRole = {};
    allMembers.forEach(member => {
      console.log(`  - ${member.fullname} (${member.email}): roles = ${JSON.stringify(member.roles)}`);
      
      member.roles.forEach(role => {
        if (!membersByRole[role]) {
          membersByRole[role] = [];
        }
        membersByRole[role].push({
          _id: member._id,
          fullname: member.fullname,
          email: member.email,
          ticketCount: 0 // Will be updated below
        });
      });
    });
    
    // Count tickets for each member
    for (const role in membersByRole) {
      for (const member of membersByRole[role]) {
        const ticketCount = await Ticket.countDocuments({
          assignedTo: member._id,
          status: { $in: ['Assigned', 'Processing'] }
        });
        member.ticketCount = ticketCount;
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        totalMembers: allMembers.length,
        membersByRole,
        allMembers: allMembers.map(m => ({
          _id: m._id,
          fullname: m.fullname,
          email: m.email,
          roles: m.roles,
          isActive: m.isActive
        }))
      }
    });
  } catch (error) {
    console.error('❌ Error in debugTeamMembers:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Helper function to create ticket
async function createTicketHelper({ title, description, category, creatorId, fallbackCreatorId = null, priority, files = [], bearerToken = null }) {
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

  // 3) Tìm user technical ít ticket nhất
  const technicalUsers = await getTechnicalUsers(process.env.FRAPPE_API_TOKEN);
  if (!technicalUsers.length) {
    throw new Error("Không có user technical nào để gán!");
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

  const creatorName = (await (async()=>{try{const u=await User.findById(creatorObjectId).lean();return u?.fullname||u?.email||creatorId;}catch(_){return creatorId;}})());

  const newTicket = new Ticket({
    ticketCode,
    title,
    description,
    category: category || "Email Ticket", // Default category for email tickets
    priority,
    creator: creatorObjectId,
    sla: slaPhase1Deadline,
    assignedTo: leastAssignedUser._id, // Use SupportTeamMember ObjectId
    attachments,
    status: "Assigned",
    history: [
      {
        timestamp: new Date(),
        action: TICKET_LOGS.MANUAL_ASSIGNED(creatorName, leastAssignedUser.fullname || leastAssignedUser.name), // LOG sẽ tự normalize
        user: creatorObjectId,
      },
    ],
  });

  await newTicket.save();
  
  return newTicket;
}

exports.createTicketHelper = createTicketHelper;

/**
 * 🎫 Nhận ticket - gán cho user hiện tại và chuyển sang "Processing"
 */
exports.assignTicketToMe = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;
    const userEmail = req.user.email;

    console.log('📥 [assignTicketToMe] User:', userEmail, 'Ticket:', ticketId);

    // Tìm ticket
    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket không tồn tại' });
    }

    // Kiểm tra quyền - chỉ SIS IT/System Manager mới được
    if (!req.user.roles || !req.user.roles.includes('SIS IT') && !req.user.roles.includes('System Manager')) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền nhận ticket này' });
    }

    // Kiểm tra status - chỉ ticket "Assigned" mới được nhận
    if (ticket.status !== 'Assigned') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể nhận ticket ở trạng thái "Assigned"' });
    }

    // 🔴 FIX: Tìm SupportTeamMember của user hiện tại
    const SupportTeamMember = require('../models/SupportTeamMember');
    let supportTeamMember = await SupportTeamMember.findOne({ 
      email: userEmail,
      isActive: true 
    });

    // Nếu không tìm thấy, tạo mới SupportTeamMember
    if (!supportTeamMember) {
      console.log(`⚠️  [assignTicketToMe] SupportTeamMember not found for ${userEmail}, creating new one...`);
      
      // 🔴 Lọc roles hợp lệ (chỉ giữ những role nằm trong SUPPORT_ROLES)
      const SUPPORT_ROLES = SupportTeamMember.SUPPORT_ROLES || ['Overall', 'Account', 'Camera System', 'Network System', 'Bell System', 'Software'];
      const validRoles = req.user.roles ? req.user.roles.filter(role => SUPPORT_ROLES.includes(role)) : [];
      
      console.log(`  Raw roles từ Frappe: ${JSON.stringify(req.user.roles)}`);
      console.log(`  Valid roles sau lọc: ${JSON.stringify(validRoles)}`);
      
      supportTeamMember = new SupportTeamMember({
        userId: userEmail,
        fullname: req.user.fullname || userEmail,
        email: userEmail,
        avatarUrl: req.user.avatarUrl || '',
        department: req.user.department || '',
        roles: validRoles, // ✅ Chỉ lưu role hợp lệ
        isActive: true
      });
      await supportTeamMember.save();
      console.log(`✅ Created new SupportTeamMember: ${supportTeamMember._id}`);
    }

    // Cập nhật ticket
    const previousAssignedTo = ticket.assignedTo?.fullname || 'Chưa gán';
    ticket.assignedTo = supportTeamMember._id; // ✅ Gán SupportTeamMember._id thay vì User._id
    ticket.status = 'Processing';
    ticket.acceptedAt = new Date();
    ticket.updatedAt = new Date();

    // Helper function to reverse name parts
    const reverseName = (fullname) => {
      if (!fullname) return fullname;
      const parts = fullname.trim().split(' ');
      if (parts.length <= 1) return fullname;
      // Đảo thứ tự: từ "Linh Nguyễn Hải" thành "Nguyễn Hải Linh"
      const firstName = parts[0]; // Linh
      const rest = parts.slice(1); // [Nguyễn, Hải]
      const result = rest.join(' ') + ' ' + firstName; // "Nguyễn Hải Linh"
      console.log(`🔄 [reverseName] "${fullname}" -> "${result}"`);
      return result;
    };

    // Log history
    const assigneeName = req.user.fullname; // LOG sẽ tự normalize
    const previousName = previousAssignedTo;
    console.log(`📝 [assignTicketToMe] Assignee: "${assigneeName}", Previous: "${previousName}"`);

    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.TICKET_ACCEPTED(assigneeName, previousName),
      user: userId
    });

    await ticket.save();
    console.log(`✅ [assignTicketToMe] Ticket assigned to ${userEmail} (SupportTeamMember: ${supportTeamMember._id})`);

    // Populate và trả về
    await ticket.populate('creator assignedTo', 'fullname email avatarUrl');

    // Send notification
    try {
      await notificationService.sendTicketUpdateNotification(ticket, 'assigned', null);
    } catch (notifyError) {
      console.warn('⚠️  Error sending notification:', notifyError.message);
    }

    res.status(200).json({
      success: true,
      data: {
        _id: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        status: ticket.status,
        assignedTo: ticket.assignedTo,
        acceptedAt: ticket.acceptedAt,
        updatedAt: ticket.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error in assignTicketToMe:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 🚫 Huỷ ticket với lý do
 */
exports.cancelTicketWithReason = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { cancelReason } = req.body;
    const userId = req.user._id;

    console.log('❌ [cancelTicket] User:', req.user.email, 'Ticket:', ticketId, 'Reason:', cancelReason);

    // Kiểm tra lý do
    if (!cancelReason || !cancelReason.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập lý do huỷ ticket' });
    }

    // Tìm ticket
    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket không tồn tại' });
    }

    // Kiểm tra quyền - creator hoặc assignedTo hoặc admin
    const isCreator = ticket.creator._id.toString() === userId.toString();
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo._id.toString() === userId.toString();
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';

    if (!isCreator && !isAssignedTo && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền huỷ ticket này' });
    }

    // Cập nhật ticket
    ticket.status = 'Cancelled';
    ticket.cancellationReason = cancelReason.trim();
    ticket.updatedAt = new Date();

    // Log history
    const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.TICKET_CANCELLED(userName, cancelReason.trim()),
      user: userId
    });

    await ticket.save();
    console.log(`✅ [cancelTicket] Ticket cancelled: ${ticketId}`);

    // Populate và trả về
    await ticket.populate('creator assignedTo', 'fullname email avatarUrl');

    // Send notification
    try {
      await notificationService.sendTicketUpdateNotification(ticket, 'status_updated', null);
    } catch (notifyError) {
      console.warn('⚠️  Error sending notification:', notifyError.message);
    }

    res.status(200).json({
      success: true,
      data: {
        _id: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        status: ticket.status,
        cancellationReason: ticket.cancellationReason,
        updatedAt: ticket.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error in cancelTicketWithReason:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ Chấp nhận kết quả với feedback, sao, và badges
 * POST /:ticketId/accept-feedback
 * Body: { rating, comment, badges }
 */
exports.acceptFeedback = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { rating, comment, badges } = req.body;
    const userId = req.user._id;
    const userEmail = req.user.email;

    console.log(`✅ [acceptFeedback] User: ${userEmail}, Ticket: ${ticketId}, Rating: ${rating}`);

    // Validate input
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn đánh giá từ 1-5 sao'
      });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập feedback'
      });
    }

    // Tìm ticket
    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Kiểm tra quyền - chỉ creator hoặc assignedTo có thể feedback
    const isCreator = ticket.creator._id.toString() === userId.toString();
    if (!isCreator) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ người tạo ticket mới có thể gửi feedback'
      });
    }

    // Kiểm tra trạng thái ticket
    if (ticket.status !== 'Done') {
      return res.status(400).json({
        success: false,
        message: 'Ticket phải ở trạng thái hoàn thành mới có thể gửi feedback'
      });
    }

    // Cập nhật feedback
    ticket.feedback = {
      assignedTo: ticket.assignedTo?._id,
      rating: parseInt(rating),
      comment: comment.trim(),
      badges: Array.isArray(badges) ? badges : []
    };

    // Chuyển ticket sang Closed
    ticket.status = 'Closed';
    ticket.closedAt = new Date();
    ticket.updatedAt = new Date();


    await ticket.save();
    console.log(`✅ [acceptFeedback] Feedback saved and ticket closed: ${ticketId}`);

    // 🔄 Cập nhật rating cho kỹ thuật viên trong Frappe
    if (ticket.assignedTo && ticket.assignedTo.email) {
      try {
        const frappeService = require('../services/frappeService');
        const token = req.header('Authorization')?.replace('Bearer ', '');

        // Lấy user info từ Frappe để cập nhật rating
        const technician = await frappeService.getUserDetails(ticket.assignedTo.email, token);
        
        // Tính trung bình rating từ tất cả feedback cho user này
        const allTicketsWithFeedback = await Ticket.find({
          'assignedTo._id': ticket.assignedTo._id,
          'feedback.rating': { $exists: true, $ne: null }
        });

        const totalRating = allTicketsWithFeedback.reduce((sum, t) => {
          return sum + (t.feedback?.rating || 0);
        }, 0);

        const averageRating = allTicketsWithFeedback.length > 0 
          ? (totalRating / allTicketsWithFeedback.length).toFixed(2)
          : 0;

        console.log(`📊 [acceptFeedback] Technician ${ticket.assignedTo.email} average rating: ${averageRating}`);

        // Nếu cần, có thể gọi Frappe để lưu rating vào custom field
        // await frappeService.saveDocument('User', ticket.assignedTo.email, {
        //   custom_rating: averageRating
        // }, token);

      } catch (frappeError) {
        console.warn('⚠️  [acceptFeedback] Could not update Frappe rating:', frappeError.message);
        // Không fail nếu Frappe update thất bại
      }
    }

    // Send notification
    try {
      await notificationService.sendTicketUpdateNotification(ticket, 'feedback_received', null);
    } catch (notifyError) {
      console.warn('⚠️  Error sending notification:', notifyError.message);
    }

    // Populate và trả về
    await ticket.populate('creator assignedTo', 'fullname email avatarUrl');

    res.status(200).json({
      success: true,
      message: 'Feedback đã được lưu. Cảm ơn bạn!',
      data: {
        _id: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        status: ticket.status,
        feedback: ticket.feedback,
        closedAt: ticket.closedAt,
        updatedAt: ticket.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error in acceptFeedback:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lưu feedback'
    });
  }
};

/**
 * 🔄 Mở lại ticket (chuyển từ Done/Closed sang Processing)
 * POST /:ticketId/reopen
 */
exports.reopenTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;
    const userEmail = req.user.email;

    console.log(`🔄 [reopenTicket] User: ${userEmail}, Ticket: ${ticketId}`);

    // Tìm ticket
    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Kiểm tra quyền - chỉ creator hoặc assignedTo có thể mở lại
    const isCreator = ticket.creator._id.toString() === userId.toString();
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo._id.toString() === userId.toString();
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';

    if (!isCreator && !isAssignedTo && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền mở lại ticket này'
      });
    }

    // Kiểm tra trạng thái ticket - chỉ có thể mở lại từ Done/Closed
    if (ticket.status !== 'Done' && ticket.status !== 'Closed') {
      return res.status(400).json({
        success: false,
        message: `Ticket đang ở trạng thái "${ticket.status}". Chỉ có thể mở lại ticket ở trạng thái hoàn thành.`
      });
    }

    // Cập nhật ticket
    const previousStatus = ticket.status;
    ticket.status = 'Processing';
    ticket.updatedAt = new Date();
    
    // Clear feedback nếu đang ở Closed
    if (previousStatus === 'Closed') {
      ticket.feedback = {
        assignedTo: null,
        rating: null,
        comment: '',
        badges: []
      };
    }

    // Log history
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.TICKET_REOPENED(req.user.fullname, previousStatus), // LOG sẽ tự normalize
      user: userId
    });

    await ticket.save();
    console.log(`✅ [reopenTicket] Ticket reopened: ${ticketId}, new status: Processing`);

    // Send notification
    try {
      await notificationService.sendTicketUpdateNotification(ticket, 'reopen', null);
    } catch (notifyError) {
      console.warn('⚠️  Error sending notification:', notifyError.message);
    }

    // Populate và trả về
    await ticket.populate('creator assignedTo', 'fullname email avatarUrl');

    res.status(200).json({
      success: true,
      message: 'Ticket đã được mở lại',
      data: {
        _id: ticket._id,
        ticketCode: ticket.ticketCode,
        title: ticket.title,
        status: ticket.status,
        updatedAt: ticket.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error in reopenTicket:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi mở lại ticket'
    });
  }
};

/**
 * 📊 Lấy feedback stats cho team member
 * GET /feedback-stats/:email
 */
exports.getTeamMemberFeedbackStats = async (req, res) => {
  try {
    const { email } = req.params;

    console.log(`📊 [getTeamMemberFeedbackStats] Fetching stats for: ${email}`);

    // Tìm SupportTeamMember từ email
    const SupportTeamMember = require('../models/SupportTeamMember');
    const teamMember = await SupportTeamMember.findOne({ email });

    if (!teamMember) {
      console.log(`⚠️  [getTeamMemberFeedbackStats] Team member not found for email: ${email}`);
      return res.status(200).json({
        success: true,
        data: {
          averageRating: 0,
          totalFeedbacks: 0,
          badges: [],
          badgeCounts: {}
        }
      });
    }

    // Lấy tất cả tickets của team member này với feedback
    // assignedTo là ObjectId, nên query trực tiếp
    const tickets = await Ticket.find({
      assignedTo: teamMember._id,
      'feedback.rating': { $exists: true, $ne: null },
      status: 'Closed'
    }).lean();

    console.log(`📋 [getTeamMemberFeedbackStats] Found ${tickets.length} closed tickets with feedback for ${email}`);

    if (tickets.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          averageRating: 0,
          totalFeedbacks: 0,
          badges: [],
          badgeCounts: {}
        }
      });
    }

    // Tính trung bình rating
    const totalRating = tickets.reduce((sum, t) => sum + (t.feedback?.rating || 0), 0);
    const averageRating = totalRating / tickets.length;

    // Tính tổng huy hiệu
    const badgeCounts = {};
    const uniqueBadges = [];

    tickets.forEach(ticket => {
      if (ticket.feedback?.badges && Array.isArray(ticket.feedback.badges)) {
        ticket.feedback.badges.forEach(badge => {
          if (!badgeCounts[badge]) {
            badgeCounts[badge] = 0;
            uniqueBadges.push(badge);
          }
          badgeCounts[badge]++;
        });
      }
    });

    console.log(`✅ [getTeamMemberFeedbackStats] Stats: avg rating=${averageRating.toFixed(2)}, total feedbacks=${tickets.length}, badges=${uniqueBadges.join(', ')}`);

    res.status(200).json({
      success: true,
      data: {
        averageRating: parseFloat(averageRating.toFixed(2)),
        totalFeedbacks: tickets.length,
        badges: uniqueBadges,
        badgeCounts
      }
    });

  } catch (error) {
    console.error('❌ Error in getTeamMemberFeedbackStats:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy feedback stats'
    });
  }
};
