// /backend/controllers/emailController.js
const nodemailer = require("nodemailer");
const Ticket = require("../models/Ticket");
const { v4: uuidv4 } = require("uuid");
const ticketController = require("./ticketController");
const { convert } = require('html-to-text'); // Added import for html-to-text
const axios = require('axios');

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';

// Build auth headers for Frappe requests (prefer API key/secret)
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

// Helper function to get user from Frappe
async function getFrappeUserByEmail(email) {
  try {
    const response = await axios.get(
      `${FRAPPE_API_URL}/api/resource/User`,
      {
        params: {
          filters: JSON.stringify([["email","=", email]]),
          fields: JSON.stringify(['name','email','full_name','user_image','enabled','department'])
        },
        headers: buildFrappeHeaders()
      }
    );
    return response.data.data && response.data.data.length > 0 ? response.data.data[0] : null;
  } catch (error) {
    console.error('Error getting user from Frappe by email:', error);
    return null;
  }
}

// Helper: map email -> local Users collection (_id)
async function getLocalUserIdByEmail(email) {
  try {
    const Users = require('../models/Users');
    const user = await Users.findOne({ email }).select('_id email fullname');
    return user ? user._id : null;
  } catch (err) {
    console.warn('[Ticket Service] getLocalUserIdByEmail error:', err.message);
    return null;
  }
}

// Initialize Azure Graph client only if credentials are available
let graphClient = null;
let credential = null;

if (process.env.TENANT_ID && process.env.CLIENT_ID && process.env.CLIENT_SECRET) {
  try {
    const { ClientSecretCredential } = require("@azure/identity");
    const { Client } = require("@microsoft/microsoft-graph-client");
    const { TokenCredentialAuthenticationProvider } = require("@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials");

    // Khởi tạo OAuth 2.0 credentials
    credential = new ClientSecretCredential(
      process.env.TENANT_ID,
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    });

    graphClient = Client.initWithMiddleware({
      authProvider: authProvider,
    });
    
    console.log('✅ [Ticket Service] Azure Graph client initialized');
  } catch (error) {
    console.warn('⚠️ [Ticket Service] Azure Graph client initialization failed:', error.message);
  }
} else {
  console.warn('⚠️ [Ticket Service] Azure credentials not found, email features will be disabled');
}

// Hàm lấy access token cho OAuth 2.0
const getAccessToken = async () => {
  if (!credential) {
    throw new Error('Azure credential not initialized');
  }
  
  try {
    console.log("Đang lấy access token...");
    const token = await credential.getToken("https://graph.microsoft.com/.default");
    console.log("Access token lấy thành công!");
    return token.token;
  } catch (error) {
    console.error("Lỗi khi lấy access token:", error);
    throw error;
  }
};

// Khởi tạo transporter cho SMTP (dùng OAuth 2.0)
const createTransporter = async () => {
  if (!credential) {
    throw new Error('Azure credential not initialized');
  }
  
  const accessToken = await getAccessToken();

  console.log("Đang tạo transporter SMTP...");
  console.log("SMTP Email:", process.env.EMAIL_USER);

  return nodemailer.createTransport({
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: process.env.EMAIL_USER,
      type: "OAuth2",
      accessToken: accessToken,
    },
    tls: {
      ciphers: "SSLv3",
    },
  });
};

// A) Hàm gửi email cập nhật trạng thái ticket
exports.sendTicketStatusEmail = async (req, res) => {
  try {
    if (!credential) {
      return res.status(500).json({ 
        success: false, 
        message: "Azure credential not initialized. Please check Azure credentials." 
      });
    }

    const { ticketId, recipientEmail } = req.body;
    console.log("Đang gửi email cho ticket:", ticketId, "tới:", recipientEmail);

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      console.log("Ticket không tồn tại:", ticketId);
      return res.status(404).json({ success: false, message: "Ticket không tồn tại" });
    }

    const transporter = await createTransporter();
    const mailOptions = {
      from: `"Hệ thống Support" <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: `[Ticket #${ticket.ticketCode}] Cập nhật trạng thái: ${ticket.status}`,
      text: `Xin chào,\n\nTicket của bạn hiện ở trạng thái: ${ticket.status}\n\nTrân trọng,\nHệ thống Support.`,
      html: `<p>Xin chào,</p><p>Ticket của bạn hiện ở trạng thái: <strong>${ticket.status}</strong></p><p>Trân trọng,<br>Hệ thống Support</p>`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email gửi thành công:", info.messageId);

    return res.status(200).json({ success: true, message: "Đã gửi email cập nhật ticket." });
  } catch (error) {
    console.error("Lỗi khi gửi email ticket:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Core inbox processor (reusable for route and background job)
async function processInboxOnce() {
  if (!credential || !graphClient) {
    console.warn('[Ticket Service] Graph client not initialized - skip email polling');
    return { success: false, reason: 'graph_not_initialized', created: 0, skipped: 0 };
  }

  const userEmail = process.env.EMAIL_USER;
  const messages = await graphClient
    .api(`/users/${userEmail}/mailFolders/Inbox/messages`)
    .filter('isRead eq false')
    .select('subject,from,body,hasAttachments')
    .expand('attachments')
    .top(50)
    .get();

  const list = messages.value || [];
  if (!list.length) {
    return { success: true, created: 0, skipped: 0 };
  }

  console.log(`[Ticket Service] Tìm thấy ${list.length} email chưa đọc`);

  let created = 0;
  let skipped = 0;

  for (const msg of list) {
    try {
      const subject = msg.subject || 'Email Support';
      const from = msg.from?.emailAddress?.address || '';
      const content = msg.body?.content || '';
      const lowerSubject = subject.trim().toLowerCase();
      if (lowerSubject.startsWith('re:') || lowerSubject.startsWith('trả lời:')) {
        await graphClient.api(`/users/${userEmail}/messages/${msg.id}`).update({ isRead: true });
        skipped++; continue;
      }

      // Only accept internal domain
      if (!from.endsWith('@wellspring.edu.vn')) {
        await graphClient.api(`/users/${userEmail}/messages/${msg.id}`).update({ isRead: true });
        skipped++; continue;
      }

      const plainContent = convert(content, { wordwrap: 130 });

      // Find creator in Frappe (via API Key/Secret or token)
      const creatorUser = await getFrappeUserByEmail(from);
      if (!creatorUser) {
        console.warn(`[Ticket Service] Không tìm thấy user Frappe cho ${from}, đánh dấu đã đọc và bỏ qua`);
        await graphClient.api(`/users/${userEmail}/messages/${msg.id}`).update({ isRead: true });
        skipped++; continue;
      }

      // Map sang user local (Mongo) theo email để lấy _id làm creator
      const localCreatorId = await getLocalUserIdByEmail(from);
      if (!localCreatorId) {
        console.warn(`[Ticket Service] Không tìm thấy user LOCAL cho ${from}, đánh dấu đã đọc và bỏ qua`);
        await graphClient.api(`/users/${userEmail}/messages/${msg.id}`).update({ isRead: true });
        skipped++; continue;
      }

      let attachments = [];
      if (msg.hasAttachments && msg.attachments?.value?.length) {
        attachments = msg.attachments.value
          .filter(att => att['@odata.type'] === '#microsoft.graph.fileAttachment')
          .map(att => ({ filename: att.name, url: `data:${att.contentType};base64,${att.contentBytes}` }));
      }

      // Chuyển attachments sang dạng tương thích với createTicketHelper (giống multer)
      const helperFiles = attachments.map(att => ({ originalname: att.filename, filename: att.url }));

      const newTicket = await ticketController.createTicketHelper({
        title: subject,
        description: plainContent,
        creatorId: localCreatorId,
        priority: 'Medium',
        files: helperFiles,
      });
      try {
        console.log(`[Ticket Service] Tạo ticket từ email ${from}: ${newTicket.ticketCode}`);
      } catch (_) {}

      await graphClient.api(`/users/${userEmail}/messages/${msg.id}`).update({ isRead: true });
      created++;
    } catch (e) {
      console.error('[Ticket Service] Error processing email:', e.message);
      // do not mark as read so it can be retried next run
    }
  }

  return { success: true, created, skipped };
}

// B) Route wrapper to process inbox on demand
exports.fetchEmailsAndCreateTickets = async (req, res) => {
  try {
    const result = await processInboxOnce();
    const status = result.success ? 200 : 500;
    return res.status(status).json({ success: result.success, ...result });
  } catch (error) {
    console.error('Lỗi khi fetch email:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// B2) Peek inbox (debug: liệt kê nhanh 10 email gần nhất)
exports.peekInbox = async (req, res) => {
  try {
    if (!credential || !graphClient) {
      return res.status(500).json({ success: false, reason: 'graph_not_initialized' });
    }

    const userEmail = process.env.EMAIL_USER;
    const messages = await graphClient
      .api(`/users/${userEmail}/mailFolders/Inbox/messages`)
      .select('id,subject,from,isRead,receivedDateTime')
      .top(10)
      .orderby('receivedDateTime desc')
      .get();

    const list = (messages.value || []).map(m => ({
      id: m.id,
      subject: m.subject,
      from: m.from?.emailAddress?.address,
      isRead: m.isRead,
      received: m.receivedDateTime
    }));

    return res.status(200).json({ success: true, email: userEmail, count: list.length, list });
  } catch (error) {
    console.error('Lỗi khi peek inbox:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// C) Hàm chạy định kỳ (dùng với cron job nếu cần)
exports.processInboxOnce = processInboxOnce;