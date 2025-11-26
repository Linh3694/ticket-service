const Ticket = require("../../models/Ticket");
const SupportTeam = require("../../models/SupportTeam");
const SupportTeamMember = require("../../models/SupportTeamMember");
const notificationService = require('../../services/notificationService');
const emailController = require('../emailController');
const { TICKET_LOGS, SUBTASK_LOGS, OTHER_LOGS, normalizeVietnameseName, translateStatus } = require('../../utils/logFormatter');
const { logTicketCreated, logTicketStatusChanged, logTicketAccepted, logTicketResolved, logTicketCancelled, logTicketReopened, logAPICall, logError } = require('../../utils/logger');
const mongoose = require("mongoose");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Import User model for getTechnicalUsers
const User = require("../../models/Users");

// Helper function để fix assignedTo null issue sau khi populate
async function fixAssignedToIfNull(ticket) {
  if (!ticket) return ticket;
  
  // Nếu assignedTo null sau populate, tức là user không tồn tại trong DB
  if (ticket.assignedTo === null || !ticket.assignedTo || !ticket.assignedTo._id) {
    // Lấy assignedTo ID từ raw data nếu có
    const ticket_raw = await Ticket.findById(ticket._id).select('assignedTo').lean();
    if (ticket_raw && ticket_raw.assignedTo) {
      const user = await User.findById(ticket_raw.assignedTo)
        .select('_id fullname email avatarUrl jobTitle department')
        .lean();
      if (user) {
        ticket.assignedTo = user;
      }
    }
  }
  return ticket;
}

// Helper function để populate assignedTo field với full user data
async function populateAssignedToData(tickets) {
  if (!tickets) return tickets;
  
  const isArray = Array.isArray(tickets);
  const ticketsArray = isArray ? tickets : [tickets];
  
  // Lấy tất cả unique email từ assignedTo
  const memberIds = new Set();
  const userIds = new Set();
  
  ticketsArray.forEach(t => {
    if (t.assignedTo) {
      if (t.assignedTo._id) {
        memberIds.add(t.assignedTo._id.toString());
      } else if (typeof t.assignedTo === 'string') {
        // Nếu assignedTo là string ID
        userIds.add(t.assignedTo);
      }
    }
  });
  
  if (memberIds.size === 0 && userIds.size === 0) return tickets;
  
  // Populate SupportTeamMember -> User data
  const SupportTeamMember = require("../../models/SupportTeamMember");
  const memberEmails = [];
  
  for (const memberId of memberIds) {
    const member = await SupportTeamMember.findById(memberId).lean();
    if (member && member.email) {
      memberEmails.push(member.email);
    }
  }
  
  // Lấy users trực tiếp từ User collection
  const users = [];
  if (memberEmails.length > 0) {
    const foundUsers = await User.find({ email: { $in: memberEmails } })
      .select('email fullname avatarUrl jobTitle department')
      .lean();
    users.push(...foundUsers);
  }
  
  // Thêm users từ userIds set
  if (userIds.size > 0) {
    const userIdArray = Array.from(userIds);
    const foundUsers = await User.find({ _id: { $in: userIdArray } })
      .select('_id email fullname avatarUrl jobTitle department')
      .lean();
    users.push(...foundUsers);
  }
  
  const userMap = new Map(users.map(u => [u.email || u._id.toString(), u]));
  
  // Update tickets with user data
  ticketsArray.forEach(t => {
    // Handle cases where assignedTo is null after populate
    if (t.assignedTo === null) {
      console.log(`⚠️  [populateAssignedToData] assignedTo is null for ticket: ${t.ticketCode}`);
      t.assignedTo = null; // Keep it as null, frontend should handle this
    } else if (t.assignedTo) {
      const member = t.assignedTo;
      
      if (member._id) {
        // Nếu assignedTo là object nhưng chưa có fullname
        if (member.email) {
          const user = userMap.get(member.email);
          if (user) {
            t.assignedTo = {
              _id: member._id,
              email: member.email || user.email,
              fullname: user.fullname || member.email,
              avatarUrl: user.avatarUrl || '',
              jobTitle: user.jobTitle || '',
              department: user.department || ''
            };
          }
        }
      } else if (typeof member === 'string') {
        // Nếu assignedTo là string ID
        const user = userMap.get(member);
        if (user) {
          t.assignedTo = {
            _id: user._id,
            email: user.email,
            fullname: user.fullname,
            avatarUrl: user.avatarUrl || '',
            jobTitle: user.jobTitle || '',
            department: user.department || ''
          };
        }
      }
    }
  });
  
  return isArray ? ticketsArray : ticketsArray[0];
}

// Create ticket from email (internal API for email service)
const createTicketFromEmail = async (req, res) => {
  try {
    console.log('[createTicketFromEmail] Creating ticket from email...');
    console.log('[createTicketFromEmail] Request body:', JSON.stringify(req.body, null, 2));

    const {
      id: emailId,
      title: subject,  // Email service sends 'title', but we use 'subject'
      description: plainContent,  // Email service sends 'description', but we use 'plainContent'
      creatorId,
      files: attachments,  // Email service sends 'files', but we use 'attachments'
      priority = 'Medium'
    } = req.body;

    // Validate required fields
    if (!subject || !plainContent) {
      console.log('[createTicketFromEmail] ❌ Validation failed: missing title or description');
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    // Import helper functions
    const { generateTicketCode } = require('../../utils/ticketHelper');
    const { TICKET_LOGS } = require('../../utils/logFormatter');

    // Creator is required for email tickets
    if (!creatorId) {
      console.log('[createTicketFromEmail] ❌ No creator ID provided');
      return res.status(400).json({
        success: false,
        message: 'Creator ID is required'
      });
    }

    console.log('[createTicketFromEmail] 🔄 Generating ticket code...');
    const ticketCode = await generateTicketCode('Email Ticket');
    console.log(`[createTicketFromEmail] ✅ Generated ticket code: ${ticketCode}`);

    // Ensure we have a valid creator
    if (!creatorId) {
      console.log('[createTicketFromEmail] ⚠️ No creator ID provided, cannot create ticket');
      return res.status(400).json({
        success: false,
        message: 'Creator ID is required'
      });
    }

    console.log('[createTicketFromEmail] 🎫 Creating ticket object...');

    // Auto-assign email tickets to support team members with "Email Ticket" role
    console.log('[createTicketFromEmail] 🔄 Auto-assigning email ticket to support team members with Email Ticket role...');
    let assignedTo = null;

    try {
      // Find support team members for 'Email Ticket' category
      // SupportTeamMember already imported at top of file
      const supportMembers = await SupportTeamMember.find({
        isActive: true,
        roles: { $in: ['Email Ticket'] } // Email tickets go to members with Email Ticket role
      }).populate('userId', 'fullname email avatarUrl jobTitle department');

      console.log(`[createTicketFromEmail] 🔍 Found ${supportMembers.length} support members with Email Ticket role`);
      supportMembers.forEach((member, index) => {
        console.log(`[createTicketFromEmail] Member ${index + 1}: ${member.email}, userId: ${member.userId ? (member.userId._id || 'no _id') : 'not populated'}`);
      });

      if (supportMembers && supportMembers.length > 0) {
          // Find member with least active tickets (simple load balancing)
        let bestMember = null;
        let minTickets = Infinity;

        for (const member of supportMembers) {
          if (member.userId) {
            try {
              let userIdForQuery;

              if (member.userId._id && typeof member.userId._id !== 'string') {
                // Populated ObjectId
                userIdForQuery = member.userId._id;
              } else if (typeof member.userId === 'string' && member.userId.match(/^[0-9a-fA-F]{24}$/)) {
                // ObjectId string
                userIdForQuery = require('mongoose').Types.ObjectId(member.userId);
              } else if (typeof member.userId === 'string') {
                // Email string - find User by email
                const User = require("../../models/Users");
                const userByEmail = await User.findOne({ email: member.userId }).select('_id').lean();
                if (userByEmail) {
                  userIdForQuery = userByEmail._id;
                } else {
                  console.log(`[createTicketFromEmail] ⚠️ Cannot resolve userId for member ${member.email}`);
                  continue;
                }
              } else {
                console.log(`[createTicketFromEmail] ⚠️ Invalid userId format for member ${member.email}`);
                continue;
              }

              const activeTickets = await Ticket.countDocuments({
                assignedTo: userIdForQuery,
                status: { $in: ['Assigned', 'Processing', 'Waiting for Customer'] }
              });

              console.log(`[createTicketFromEmail] 📊 Member ${member.userId.fullname || member.email} has ${activeTickets} active tickets`);

              if (activeTickets < minTickets) {
                minTickets = activeTickets;
                bestMember = member;
              }
            } catch (countError) {
              console.log(`[createTicketFromEmail] ⚠️ Error counting tickets for member ${member.email}:`, countError.message);
              // Continue with other members
            }
          } else {
            console.log(`[createTicketFromEmail] ⚠️ Skipping member ${member.email} - no userId`);
          }
        }

        if (bestMember && bestMember.userId) {
          // Use the same logic as above to get the correct userId
          if (bestMember.userId._id && typeof bestMember.userId._id !== 'string') {
            assignedTo = bestMember.userId._id;
          } else if (typeof bestMember.userId === 'string' && bestMember.userId.match(/^[0-9a-fA-F]{24}$/)) {
            assignedTo = require('mongoose').Types.ObjectId(bestMember.userId);
          } else if (typeof bestMember.userId === 'string') {
            // Email string - find User by email
            const User = require("../../models/Users");
            const userByEmail = await User.findOne({ email: bestMember.userId }).select('_id').lean();
            if (userByEmail) {
              assignedTo = userByEmail._id;
            }
          }

          if (assignedTo) {
            console.log(`[createTicketFromEmail] ✅ Auto-assigned to: ${bestMember.userId.fullname || bestMember.email} (${bestMember.userId.email || bestMember.email})`);
            console.log(`[createTicketFromEmail] 📊 Member has ${minTickets} active tickets`);
          } else {
            console.log('[createTicketFromEmail] ⚠️ Could not resolve assignedTo for best member');
          }
        } else {
          console.log('[createTicketFromEmail] ⚠️ No suitable support member found for auto-assignment');
        }
      } else {
        console.log('[createTicketFromEmail] ⚠️ No active support team members found');
      }
    } catch (assignError) {
      console.log('[createTicketFromEmail] ⚠️ Error during auto-assignment:', assignError.message);
      // Continue without assignment
    }

    // Create ticket
    const ticket = new Ticket({
      ticketCode: ticketCode,
      title: subject,
      description: plainContent,
      category: 'Email Ticket',
      status: 'Assigned', // Use valid enum value instead of 'New'
      priority: priority,
      creator: creatorId,
      assignedTo: assignedTo, // Auto-assigned support member
      source: 'email',
      emailId: emailId,
      attachments: attachments || [],
      history: [{
        timestamp: new Date(),
        action: TICKET_LOGS.TICKET_CREATED('Email Service'),
        user: null // System user
      }]
    });

    console.log('[createTicketFromEmail] 💾 Saving ticket to database...');
    await ticket.save();
    console.log(`[createTicketFromEmail] ✅ Ticket saved with ID: ${ticket._id}`);

    // Populate creator for response
    try {
      await ticket.populate('creator', 'fullname email avatarUrl jobTitle department');
      console.log('[createTicketFromEmail] ✅ Creator populated');
    } catch (populateError) {
      console.log('[createTicketFromEmail] ⚠️ Creator populate failed:', populateError.message);
    }

    console.log(`[createTicketFromEmail] ✅ Created ticket ${ticket.ticketCode} from email`);

    res.status(201).json({
      success: true,
      ticket: ticket,
      message: `Ticket ${ticket.ticketCode} created successfully`
    });

  } catch (error) {
    console.error('[createTicketFromEmail] ❌ Error:', error);
    console.error('[createTicketFromEmail] Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create ticket from email',
      error: error.message
    });
  }
};

// Helper function to get or create system user for email tickets
async function getOrCreateSystemUser() {
  try {
    const User = require('../models/Users');

    // Try to find existing system user
    let systemUser = await User.findOne({ email: 'system@email.wellspring.edu.vn' });

    if (!systemUser) {
      // Create system user if not exists
      systemUser = new User({
        email: 'system@email.wellspring.edu.vn',
        fullname: 'Email System',
        role: 'system',
        provider: 'system',
        active: true,
        disabled: false,
        roles: [],
        frappeUserId: null,
        employeeCode: null,
        jobTitle: 'System User',
        department: 'IT Support',
        avatarUrl: '',
        microsoftId: null
      });

      await systemUser.save();
      console.log('[getOrCreateSystemUser] ✅ Created system user for email tickets');
    }

    return systemUser;
  } catch (error) {
    console.error('[getOrCreateSystemUser] ❌ Error creating/finding system user:', error);
    throw error;
  }
}

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';

// Helper function to build full file URL after FRAPPE_API_URL constant
function buildFullFileUrl(relativePath) {
  return `${FRAPPE_API_URL}${relativePath}`;
}

/**
 * Get technical users for ticket assignment
 * Returns users with technical/IT roles
 */
async function getTechnicalUsers(token = null) {
  try {
    // For email tickets, prioritize users with "Email Ticket" role
    // Query với filter roles (sẽ auto-populate user data)
    const emailTicketMembers = await SupportTeamMember.getAllMembers({ roles: 'Email Ticket' });

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
        fullname: member.fullname, // Already populated from Users
        name: member.fullname,
        disabled: false // Members are always active
      }));
    }

    // Fallback: get from SupportTeamMember collection (other technical roles)
    const allMembers = await SupportTeamMember.getAllMembers();
    const supportMembers = allMembers.filter(m =>
      m.roles && m.roles.some(r => ['Overall', 'Software', 'Network System', 'Camera System', 'Bell System'].includes(r))
    );

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
        fullname: member.fullname, // Already populated from Users
        name: member.fullname,
        disabled: false // Members are always active
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

/**
 * Create new ticket
 */
// Helper function to send email when status changes
const sendStatusChangeEmail = async (ticket, previousStatus, newStatus, user) => {
  try {
    console.log(`📧 [sendStatusChangeEmail] Status changed from ${previousStatus} to ${newStatus} for ticket ${ticket.ticketCode}`);

    // Handle "Waiting for Customer" status changes with special logic
    if (newStatus === 'Waiting for Customer') {
      // Special case: Only send email once when transitioning from "Processing" to "Waiting for Customer"
      if (previousStatus === 'Processing') {
        if (ticket.waitingForCustomerEmailSent) {
          console.log(`📧 [sendStatusChangeEmail] Email already sent for Processing->Waiting for Customer on ticket ${ticket.ticketCode}, skipping...`);
          return;
        }
        console.log(`📧 [sendStatusChangeEmail] Sending first-time email for Processing->Waiting for Customer transition`);
      } else {
        // For other transitions to "Waiting for Customer", always send email
        console.log(`📧 [sendStatusChangeEmail] Sending email for ${previousStatus}->Waiting for Customer transition (not from Processing)`);
      }
    }
    // For other status changes (Done, Closed, Cancelled, etc.), always send email
    else {
      console.log(`📧 [sendStatusChangeEmail] Sending email for status change to ${newStatus} (updated logic)`);
    }

    // Check if creator has email
    console.log(`📧 [sendStatusChangeEmail] Checking creator email: ${ticket.creator?.email}`);
    if (!ticket.creator?.email) {
      console.log(`📧 [sendStatusChangeEmail] No creator email found, skipping...`);
      return;
    }

    console.log(`📧 [sendStatusChangeEmail] Creator info:`, {
      creatorId: ticket.creator._id,
      creatorEmail: ticket.creator.email,
      creatorName: ticket.creator.fullname
    });

    const emailServiceUrl = process.env.EMAIL_SERVICE_URL || 'http://localhost:5030';
    const recipientEmail = ticket.creator.email;

    console.log(`📧 [sendStatusChangeEmail] Email service URL: ${emailServiceUrl}`);
    console.log(`📧 [sendStatusChangeEmail] Sending status change email for ticket ${ticket.ticketCode} to ${recipientEmail}`);

    // Call email service asynchronously
    const axios = require('axios');
    await axios.post(`${emailServiceUrl}/notify-ticket-status`, {
      ticketId: ticket._id.toString(),
      recipientEmail: recipientEmail
    }, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    // Mark email as sent only for Processing -> Waiting for Customer transition
    if (previousStatus === 'Processing' && newStatus === 'Waiting for Customer') {
      ticket.waitingForCustomerEmailSent = true;
      await ticket.save();
      console.log(`✅ [sendStatusChangeEmail] Marked waitingForCustomerEmailSent=true for ticket ${ticket.ticketCode}`);
    }

    console.log(`✅ [sendStatusChangeEmail] Email notification sent successfully for ticket ${ticket.ticketCode}`);
  } catch (error) {
    console.error(`❌ [sendStatusChangeEmail] Failed to send email notification:`, error.message);
    console.error(`❌ [sendStatusChangeEmail] Error details:`, error.response?.data || error.code);
    throw error; // Re-throw to let caller handle
  }
};

const createTicket = async (req, res) => {
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
    const { generateTicketCode, assignTicketToUser, logTicketHistory } = require('../../utils/ticketHelper');

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

    // Log ticket creation
    try {
      const creatorEmail = req.user.email || 'unknown';
      const creatorName = req.user.fullname || req.user.email || 'unknown';
      logTicketCreated(creatorEmail, creatorName, newTicket._id.toString(), title, category);
    } catch (logErr) {
      console.warn('⚠️  Failed to log ticket creation:', logErr.message);
    }

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
    await logTicketHistory(newTicket._id, TICKET_LOGS.TICKET_CREATED(creatorName), userId);

    // Log assignment if assigned
    if (assignedToId) {
      const assignedUser = await User.findById(assignedToId);
      if (assignedUser) {
        const assignedName = assignedUser.fullname || assignedUser.email;
        await logTicketHistory(newTicket._id, TICKET_LOGS.AUTO_ASSIGNED(assignedName), userId);
      }
    }

    // 5️⃣ Send notifications (removed - method doesn't exist)
    // try {
    //   if (assignedToId) {
    //     await notificationService.sendTicketAssigned(newTicket, assignedToId);
    //   }
    // } catch (notificationError) {
    //   console.error('❌ Notification error:', notificationError);
    //   // Don't fail the request if notification fails
    // }

    // 6️⃣ Send ticket creation confirmation email to creator
    try {
      const emailServiceUrl = process.env.EMAIL_SERVICE_URL || 'http://localhost:5030';
      const creatorEmail = req.user.email;

      console.log(`📧 [createTicket] Sending ticket creation confirmation email to ${creatorEmail}`);

      // Call email service to send ticket creation notification
      const axios = require('axios');
      const emailResponse = await axios.post(`${emailServiceUrl}/notify-ticket-creation`, {
        ticketId: newTicket._id.toString(),
        recipientEmail: creatorEmail
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      // Save Message-ID for email threading
      if (emailResponse.data.success && emailResponse.data.messageId) {
        newTicket.emailMessageId = emailResponse.data.messageId;
        await newTicket.save();
        console.log(`💾 [createTicket] Saved email Message-ID: ${emailResponse.data.messageId}`);
      }

      console.log(`✅ [createTicket] Ticket creation confirmation email sent to ${creatorEmail}`);
    } catch (emailError) {
      console.error(`❌ [createTicket] Failed to send ticket creation email:`, emailError.message);
      // Don't fail the request if email fails
    }

    // Populate for response
    await newTicket.populate('creator', 'fullname email avatarUrl jobTitle department');
    await newTicket.populate('assignedTo', 'fullname email avatarUrl jobTitle department _id');
    
    // Fix: If assignedTo populate returns null but was assigned, use the ID
    if (assignedToId && (!newTicket.assignedTo || !newTicket.assignedTo._id)) {
      console.log(`⚠️  [createTicket] assignedTo is null after populate, fetching user data`);
      const assignedUser = await User.findById(assignedToId).select('_id fullname email avatarUrl jobTitle department').lean();
      if (assignedUser) {
        newTicket.assignedTo = assignedUser;
      }
    }

    res.status(201).json({
      success: true,
      data: newTicket,
      message: 'Ticket đã được tạo thành công'
    });

  } catch (error) {
    console.error('❌ [createTicket] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tạo ticket',
      error: error.message
    });
  }
};

/**
 * Get tickets with filtering
 */
const getTickets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      category,
      priority,
      assignedTo,
      creator,
      search
    } = req.query;

    const filter = {};

    // Add filters
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (creator) filter.creator = creator;

    // Search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { ticketCode: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get total count
    const total = await Ticket.countDocuments(filter);

    // Get paginated results
    let tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate([
        { path: 'creator', select: 'fullname email avatarUrl jobTitle department' },
        { path: 'assignedTo', select: '_id fullname email avatarUrl jobTitle department' }
      ])
      .lean();

    // Populate assignedTo với full user data (fullname, avatarUrl, jobTitle)
    tickets = await populateAssignedToData(tickets);

    const pages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy danh sách ticket'
    });
  }
};

/**
 * Get all tickets (for admin/support team) - without pagination
 */
const getAllTickets = async (req, res) => {
  try {
    const { status, category, assignedTo, creator, search } = req.query;

    const filter = {};

    // Add filters
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (creator) filter.creator = creator;

    // Search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { ticketCode: { $regex: search, $options: 'i' } }
      ];
    }

    let tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .populate([
        { path: 'creator', select: 'fullname email avatarUrl jobTitle department' },
        { path: 'assignedTo', select: '_id fullname email avatarUrl jobTitle department' }
      ])
      .lean();

    // Populate assignedTo với full user data (fullname, avatarUrl, jobTitle)
    tickets = await populateAssignedToData(tickets);

    res.json({
      success: true,
      data: {
        tickets
      }
    });

  } catch (error) {
    console.error('❌ Error fetching all tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy danh sách ticket'
    });
  }
};

/**
 * Get user's tickets
 */
const getMyTickets = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, category, page = 1, limit = 10 } = req.query;

    const filter = { creator: userId };

    if (status) filter.status = status;
    if (category) filter.category = category;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get total count
    const total = await Ticket.countDocuments(filter);

    // Get paginated results
    let tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate([
        { path: 'creator', select: 'fullname email avatarUrl jobTitle department' },
        { path: 'assignedTo', select: '_id fullname email avatarUrl jobTitle department' }
      ])
      .lean();

    // Populate assignedTo với full user data (fullname, avatarUrl, jobTitle)
    tickets = await populateAssignedToData(tickets);

    const pages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching my tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy danh sách ticket của bạn'
    });
  }
};

/**
 * Get ticket by ID
 */
const getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;

    let ticket = await Ticket.findById(ticketId)
      .populate('creator', 'fullname email avatarUrl jobTitle department')
      .populate('assignedTo', '_id fullname email avatarUrl jobTitle department')
      .populate('history.user', 'fullname email avatarUrl')
      .lean();

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Populate assignedTo với full user data (fullname, avatarUrl, jobTitle)
    ticket = await populateAssignedToData(ticket);

    res.json({
      success: true,
      data: ticket
    });

  } catch (error) {
    console.error('❌ Error fetching ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy thông tin ticket'
    });
  }
};

/**
 * Get ticket info for email service (internal endpoint - no auth required)
 */
const getTicketInfoForEmail = async (req, res) => {
  const { ticketId } = req.params;

  try {
    console.log(`🔍 [getTicketInfoForEmail] Getting ticket info for email service: ${ticketId}`);

    const ticket = await Ticket.findById(ticketId)
      .populate('creator', 'fullname email avatarUrl jobTitle department')
      .populate('assignedTo', '_id fullname email avatarUrl jobTitle department')
      .lean();

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    // Return only necessary fields for email template
    const ticketInfo = {
      _id: ticket._id,
      ticketCode: ticket.ticketCode,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      category: ticket.category,
      priority: ticket.priority,
      creator: {
        fullname: ticket.creator?.fullname,
        email: ticket.creator?.email
      },
      assignedTo: ticket.assignedTo ? {
        fullname: ticket.assignedTo?.fullname,
        email: ticket.assignedTo?.email
      } : null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      closedAt: ticket.closedAt
    };

    console.log(`✅ [getTicketInfoForEmail] Found ticket: ${ticket.ticketCode} (${ticket.status})`);

    res.json({
      success: true,
      data: ticketInfo
    });

  } catch (error) {
    console.error(`❌ [getTicketInfoForEmail] Error:`, error.message);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

/**
 * Update ticket
 */
const updateTicket = async (req, res) => {
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
      .populate('creator', 'fullname email avatarUrl jobTitle department')
      .populate('assignedTo', '_id fullname email avatarUrl jobTitle department');

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
      console.log(`📝 [updateTicket] Status change detected: ${previousStatus} -> ${updates.status}`);

      const userName = req.user.fullname || req.user.email; // LOG sẽ tự normalize
      ticket.history.push({
        timestamp: new Date(),
        action: TICKET_LOGS.STATUS_CHANGED(previousStatus, updates.status, userName),
        user: userId
      });

      // Set acceptedAt khi status chuyển sang "Processing"
      if (updates.status === "Processing" && !ticket.acceptedAt) {
        ticket.acceptedAt = new Date();
        console.log(`⏰ [updateTicket] Set acceptedAt for ticket ${ticket.ticketCode}`);
      }

      // Set closedAt khi status chuyển sang "Closed" hoặc "Done"
      if ((updates.status === "Closed" || updates.status === "Done") && !ticket.closedAt) {
        ticket.closedAt = new Date();
        console.log(`⏰ [updateTicket] Set closedAt for ticket ${ticket.ticketCode}`);
      }

      // 📧 Send email notification when status changes
      console.log(`📧 [updateTicket] Preparing to send email notification for status change`);

      try {
        await sendStatusChangeEmail(ticket, previousStatus, updates.status, req.user);
      } catch (error) {
        console.error(`❌ [updateTicket] Error sending email notification for ticket ${ticket.ticketCode}:`, error.message);
        // Continue with ticket update even if email notification fails
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
    await ticket.populate('creator', 'fullname email avatarUrl jobTitle department');
    await ticket.populate('assignedTo', '_id fullname email avatarUrl jobTitle department');
    
    // Fix: If assignedTo is null after populate, fetch directly from User collection
    if (ticket.assignedTo === null && ticket._id) {
      console.log(`⚠️  [updateTicket] assignedTo is null after populate, fetching...`);
      await fixAssignedToIfNull(ticket);
    }

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
    console.error('❌ Error updating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể cập nhật ticket',
      error: error.message
    });
  }
};

/**
 * Delete ticket
 */
const deleteTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: only creator can delete
    if (!ticket.creator.equals(userId) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa ticket này'
      });
    }

    await Ticket.findByIdAndDelete(ticketId);

    res.json({
      success: true,
      message: 'Ticket đã được xóa thành công'
    });

  } catch (error) {
    console.error('❌ Error deleting ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể xóa ticket'
    });
  }
};

/**
 * Assign ticket to current user
 */
const assignTicketToMe = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    console.log(`👤 [assignTicketToMe] req.user:`, JSON.stringify(req.user, null, 2));
    console.log(`🆔 [assignTicketToMe] userId: ${userId}`);

    // Check if user exists
    const userExists = await User.findById(userId);
    console.log(`🔍 [assignTicketToMe] User exists: ${!!userExists}`);
    if (userExists) {
      console.log(`👤 [assignTicketToMe] User data:`, JSON.stringify(userExists, null, 2));
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check if ticket is already assigned and accepted (status = Processing)
    // Allow re-assignment only if status is still "Assigned" (auto-assigned but not accepted yet)
    if (ticket.assignedTo && ticket.status !== 'Assigned') {
      return res.status(400).json({
        success: false,
        message: 'Ticket đã được gán cho người khác'
      });
    }

    // Store previous assignee for logging
    const previousAssigneeId = ticket.assignedTo;

    // Update ticket
    const oldStatus = ticket.status;
    console.log(`🔄 [assignTicketToMe] Before update: assignedTo=${ticket.assignedTo}, status=${oldStatus}, userId=${userId}`);
    ticket.assignedTo = userId;
    ticket.status = 'Processing';
    ticket.acceptedAt = new Date();
    console.log(`✅ [assignTicketToMe] After update: assignedTo=${ticket.assignedTo}, status=${ticket.status}`);

    // Log assignment - handle both initial assignment and transfer
    const userName = req.user.fullname || req.user.email;
    let previousAssigneeName = null;

    if (previousAssigneeId) {
      // Get previous assignee name for logging
      const previousUser = await User.findById(previousAssigneeId).select('fullname email');
      previousAssigneeName = previousUser ? (previousUser.fullname || previousUser.email) : null;
    }

    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.TICKET_ACCEPTED(userName, previousAssigneeName),
      user: userId
    });

    console.log(`💾 [assignTicketToMe] Before save: ticket.assignedTo=${ticket.assignedTo}`);
    await ticket.save();
    console.log(`💾 [assignTicketToMe] After save: ticket.assignedTo=${ticket.assignedTo}`);

    // Populate for response
    console.log(`🔍 [assignTicketToMe] Before populate: ticket.assignedTo=${ticket.assignedTo}`);
    await ticket.populate('creator', 'fullname email avatarUrl jobTitle department');
    await ticket.populate('assignedTo', '_id fullname email avatarUrl jobTitle department');
    console.log(`🔍 [assignTicketToMe] After populate: ticket.assignedTo=${JSON.stringify(ticket.assignedTo)}`);
    
    // Fix: If populate returns null, use helper to fetch from User collection
    if (!ticket.assignedTo || !ticket.assignedTo._id) {
      console.log(`⚠️  [assignTicketToMe] assignedTo is null after populate, fixing...`);
      await fixAssignedToIfNull(ticket);
      
      // If still null, fallback to req.user data
      if (!ticket.assignedTo || !ticket.assignedTo._id) {
        console.log(`⚠️  [assignTicketToMe] Still null, using req.user data as fallback`);
        ticket.assignedTo = {
          _id: req.user._id,
          fullname: req.user.fullname,
          email: req.user.email,
          avatarUrl: req.user.avatarUrl || '',
          jobTitle: req.user.jobTitle || '',
          department: req.user.department || ''
        };
      }
    }

    // Send email notification to creator when ticket is accepted by support team
    if (ticket.creator?.email && oldStatus !== ticket.status) {
      try {
        const emailServiceUrl = process.env.EMAIL_SERVICE_URL || 'http://localhost:5030';
        console.log(`📧 [assignTicketToMe] Support team accepted ticket, sending email to ${ticket.creator.email}`);

        // Call email service asynchronously
        axios.post(`${emailServiceUrl}/notify-ticket-status`, {
          ticketId: ticket._id.toString(),
          recipientEmail: ticket.creator.email
        }, {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        }).then(response => {
          console.log(`✅ [assignTicketToMe] Status change email sent to creator:`, response.data);
        }).catch(error => {
          console.error(`❌ [assignTicketToMe] Failed to send status change email:`, error.message);
        });
      } catch (emailErr) {
        console.warn('⚠️ [assignTicketToMe] Failed to initiate status change email:', emailErr.message);
      }
    }

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket đã được gán cho bạn'
    });

  } catch (error) {
    console.error('❌ Error assigning ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể gán ticket'
    });
  }
};

/**
 * Cancel ticket with reason
 */
const cancelTicketWithReason = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { cancelReason } = req.body;
    const userId = req.user._id;

    if (!cancelReason?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp lý do hủy'
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission
    if (!ticket.creator.equals(userId) && (!ticket.assignedTo || !ticket.assignedTo.equals(userId))) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền hủy ticket này'
      });
    }

    ticket.status = 'Cancelled';
    ticket.cancellationReason = cancelReason.trim();

    // Log cancellation
    const userName = req.user.fullname || req.user.email;
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.TICKET_CANCELLED(userName, cancelReason.trim()),
      user: userId
    });

    await ticket.save();

    // Log cancellation
    try {
      const userEmail = req.user.email || 'unknown';
      const userName = req.user.fullname || req.user.email || 'unknown';
      logTicketCancelled(userEmail, userName, ticket._id.toString(), cancelReason.trim());
    } catch (logErr) {
      console.warn('⚠️  Failed to log ticket cancellation:', logErr.message);
    }
    
    // Populate for response
    await ticket.populate('creator', 'fullname email avatarUrl jobTitle department');
    await ticket.populate('assignedTo', '_id fullname email avatarUrl jobTitle department');
    
    // Fix: If assignedTo is null after populate
    if (ticket.assignedTo === null && ticket._id) {
      console.log(`⚠️  [cancelTicketWithReason] assignedTo is null after populate, fetching...`);
      await fixAssignedToIfNull(ticket);
    }

    // Send email notification to creator when ticket is cancelled
    if (ticket.creator?.email) {
      try {
        const emailServiceUrl = process.env.EMAIL_SERVICE_URL || 'http://localhost:5030';
        console.log(`📧 [cancelTicketWithReason] Ticket cancelled, sending email to ${ticket.creator.email}`);

        // Call email service asynchronously
        axios.post(`${emailServiceUrl}/notify-ticket-status`, {
          ticketId: ticket._id.toString(),
          recipientEmail: ticket.creator.email
        }, {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        }).then(response => {
          console.log(`✅ [cancelTicketWithReason] Cancellation email sent to creator:`, response.data);
        }).catch(error => {
          console.error(`❌ [cancelTicketWithReason] Failed to send cancellation email:`, error.message);
        });
      } catch (emailErr) {
        console.warn('⚠️ [cancelTicketWithReason] Failed to initiate cancellation email:', emailErr.message);
      }
    }

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket đã được hủy'
    });

  } catch (error) {
    console.error('❌ Error cancelling ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể hủy ticket'
    });
  }
};

/**
 * Reopen ticket
 */
const reopenTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: only creator can reopen
    if (!ticket.creator.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ người tạo mới có thể mở lại ticket'
      });
    }

    // Check if ticket can be reopened
    if (ticket.status !== 'Done' && ticket.status !== 'Closed') {
      return res.status(400).json({
        success: false,
        message: 'Ticket không thể được mở lại'
      });
    }

    const previousStatus = ticket.status;
    ticket.status = 'Processing';
    ticket.closedAt = null;

    // Log reopening
    const userName = req.user.fullname || req.user.email;
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.TICKET_REOPENED(userName, previousStatus),
      user: userId
    });

    await ticket.save();

    // Log reopening
    try {
      const userEmail = req.user.email || 'unknown';
      const userName = req.user.fullname || req.user.email || 'unknown';
      logTicketReopened(userEmail, userName, ticket._id.toString(), previousStatus);
    } catch (logErr) {
      console.warn('⚠️  Failed to log ticket reopening:', logErr.message);
    }
    
    // Populate for response
    await ticket.populate('creator', 'fullname email avatarUrl jobTitle department');
    await ticket.populate('assignedTo', '_id fullname email avatarUrl jobTitle department');
    
    // Fix: If assignedTo is null after populate
    if (ticket.assignedTo === null && ticket._id) {
      console.log(`⚠️  [reopenTicket] assignedTo is null after populate, fetching...`);
      await fixAssignedToIfNull(ticket);
    }

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket đã được mở lại'
    });

  } catch (error) {
    console.error('❌ Error reopening ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể mở lại ticket'
    });
  }
};

// Debug function to check ticket email status
const debugTicketEmailStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findById(ticketId)
      .populate('creator', 'fullname email avatarUrl jobTitle department')
      .populate('assignedTo', '_id fullname email avatarUrl jobTitle department')
      .lean();

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const debugInfo = {
      ticketCode: ticket.ticketCode,
      status: ticket.status,
      creator: {
        _id: ticket.creator?._id,
        email: ticket.creator?.email,
        fullname: ticket.creator?.fullname
      },
      assignedTo: ticket.assignedTo ? {
        _id: ticket.assignedTo._id,
        email: ticket.assignedTo.email,
        fullname: ticket.assignedTo.fullname
      } : null,
      waitingForCustomerEmailSent: ticket.waitingForCustomerEmailSent,
      hasCreatorEmail: !!ticket.creator?.email,
      messageCount: ticket.messages?.length || 0
    };

    res.json({ success: true, debugInfo });
  } catch (error) {
    console.error('Debug ticket error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getTechnicalUsers,
  createTicket,
  getTickets,
  getAllTickets,
  getMyTickets,
  getTicketById,
  updateTicket,
  createTicketFromEmail,
  getTicketInfoForEmail,
  deleteTicket,
  assignTicketToMe,
  cancelTicketWithReason,
  reopenTicket,
  sendStatusChangeEmail,
  debugTicketEmailStatus
};
