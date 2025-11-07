// /ticket-service/controllers/emailController.js
// Migrated from workspace-backend with adaptations for ticket-service architecture

const nodemailer = require("nodemailer");
const { ClientSecretCredential } = require("@azure/identity");
const { Client } = require("@microsoft/microsoft-graph-client");
const { TokenCredentialAuthenticationProvider } = require("@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials");
const Ticket = require("../models/Ticket");
const User = require("../models/Users");
const { v4: uuidv4 } = require("uuid");
const ticketController = require("./ticketController");
const { convert } = require('html-to-text'); // Added import for html-to-text
const SupportTeamMember = require("../models/SupportTeamMember");

// Khởi tạo OAuth 2.0 credentials
const credential = process.env.TENANTTICKET_ID ? new ClientSecretCredential(
  process.env.TENANTTICKET_ID,
  process.env.CLIENTTICKET_ID,
  process.env.CLIENTTICKET_SECRET
) : null;

const authProvider = new TokenCredentialAuthenticationProvider(credential, {
  scopes: ["https://graph.microsoft.com/.default"],
});

const graphClient = Client.initWithMiddleware({
  authProvider: authProvider,
});

// Hàm lấy access token cho OAuth 2.0
const getAccessToken = async () => {
  try {
    console.log("📧 [Email] Đang lấy access token...");
    const token = await credential.getToken("https://graph.microsoft.com/.default");
    console.log("✅ [Email] Access token lấy thành công!");
    return token.token;
  } catch (error) {
    console.error("❌ [Email] Lỗi khi lấy access token:", error);
    throw error;
  }
};

// Khởi tạo transporter cho SMTP (dùng OAuth 2.0)
const createTransporter = async () => {
  const accessToken = await getAccessToken();

  console.log("📧 [Email] Đang tạo transporter SMTP...");
  console.log("📧 [Email] SMTP Email:", process.env.EMAIL_USER);

  return nodemailer.createTransporter({
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
    const { ticketId, recipientEmail } = req.body;
    console.log("📧 [Email] Đang gửi email cho ticket:", ticketId, "tới:", recipientEmail);

    const ticket = await Ticket.findById(ticketId).populate('creator assignedTo');
    if (!ticket) {
      console.log("❌ [Email] Ticket không tồn tại:", ticketId);
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
    console.log("✅ [Email] Email gửi thành công:", info.messageId);

    return res.status(200).json({ success: true, message: "Đã gửi email cập nhật ticket." });
  } catch (error) {
    console.error("❌ [Email] Lỗi khi gửi email ticket:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// B) Hàm đọc email từ inbox và tạo ticket (dùng Microsoft Graph API)
exports.fetchEmailsAndCreateTickets = async (req, res) => {
  try {
    console.log("📧 [Email] Đang đọc email từ inbox...");

    // Sử dụng /users/{EMAIL_USER} thay vì /me
    const userEmail = process.env.EMAIL_USER;
    const messages = await graphClient
      .api(`/users/${userEmail}/mailFolders/Inbox/messages`)
      .filter("isRead eq false") // Tương đương với UNSEEN trong IMAP
      .select("subject,from,body") // Lấy các trường cần thiết
      .expand("attachments")
      .top(50)
      .get();

    // Nếu không có email mới, trả về ngay
    if (!messages.value || messages.value.length === 0) {
      console.log("📧 [Email] Không có email mới");
      return res.status(200).json({ success: true, message: "Không có email mới." });
    }

    console.log(`📧 [Email] Tìm thấy ${messages.value.length} email chưa đọc`);

    let processedCount = 0;

    for (let msg of messages.value) {
      const subject = msg.subject || "Email Support";
      const from = msg.from?.emailAddress?.address || "";
      const content = msg.body?.content || "";
      const lowerSubject = subject.trim().toLowerCase();

      // Bỏ qua email reply
      if (lowerSubject.startsWith("re:") || lowerSubject.startsWith("trả lời:")) {
        console.log(`⏭️  [Email] Bỏ qua email có subject: ${subject}`);
        await graphClient
          .api(`/users/${userEmail}/messages/${msg.id}`)
          .update({ isRead: true });
        continue;
      }

      const plainContent = convert(content, { wordwrap: 130 }); // Updated to use html-to-text

      // Kiểm tra domain của người gửi
      if (!from.endsWith("@wellspring.edu.vn")) {
        console.log(`⏭️  [Email] Bỏ qua email từ ${from} vì không thuộc domain @wellspring.edu.vn`);
        // Đánh dấu email là đã đọc để không xử lý lại
        await graphClient
          .api(`/users/${userEmail}/messages/${msg.id}`)
          .update({ isRead: true });
        continue; // Bỏ qua email này
      }

      console.log("📧 [Email] Đang xử lý email từ:", from, "với tiêu đề:", subject);

      // Xử lý attachments
      let attachments = [];
      if (msg.hasAttachments && msg.attachments && msg.attachments.value && msg.attachments.value.length > 0) {
        attachments = msg.attachments.value
          .filter(att => att["@odata.type"] === "#microsoft.graph.fileAttachment")
          .map(att => ({
            filename: att.name,
            url: `data:${att.contentType};base64,${att.contentBytes}`
          }));
      }

      // Tìm user dựa trên email người gửi
      let creatorUser = await User.findOne({ email: from });

      // Nếu không tìm thấy user, tạo user tạm thời
      if (!creatorUser) {
        console.log(`👤 [Email] Không tìm thấy user với email ${from}, tạo user tạm thời...`);
        creatorUser = await User.create({
          email: from,
          fullname: from.split("@")[0], // Lấy phần trước @ làm tên tạm
          role: "user", // Gán role mặc định
          password: "temporaryPassword", // Mật khẩu tạm (nên mã hóa trong thực tế)
          provider: 'email',
          active: true,
          disabled: false
        });
        console.log("✅ [Email] Đã tạo user tạm:", creatorUser._id);
      }

      // Tạo ticket sử dụng helper từ ticketController
      try {
        const newTicket = await ticketController.createTicketHelper({
          title: subject,
          description: plainContent,
          creatorId: creatorUser._id,
          priority: "Medium",
          files: attachments,  // Email attachments
          bearerToken: req.headers.authorization?.replace('Bearer ', '') // Pass token for avatar fetching
        });

        console.log("✅ [Email] Đã tạo ticket từ email:", newTicket.ticketCode);
        processedCount++;

      } catch (ticketError) {
        console.error(`❌ [Email] Lỗi tạo ticket từ email ${subject}:`, ticketError.message);
      }

      // Đánh dấu email là đã đọc
      await graphClient
        .api(`/users/${userEmail}/messages/${msg.id}`)
        .update({ isRead: true });
      console.log(`✅ [Email] Đã đánh dấu email ${msg.id} là đã đọc`);
    }

    return res.status(200).json({
      success: true,
      message: `Đã xử lý ${processedCount} email và tạo ticket.`,
      processedEmails: processedCount
    });

  } catch (error) {
    console.error("❌ [Email] Lỗi khi fetch email:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// C) Hàm chạy định kỳ (dùng với cron job nếu cần)
exports.runEmailSync = async () => {
  try {
    console.log("🔄 [Email] Chạy email sync định kỳ...");
    await exports.fetchEmailsAndCreateTickets({}); // Gọi hàm fetch mà không cần req/res
    console.log("✅ [Email] Email sync hoàn thành");
  } catch (error) {
    console.error("❌ [Email] Lỗi đồng bộ email:", error);
  }
};

// D) Hàm gửi email thông báo cho support team khi có ticket mới
exports.sendNewTicketNotification = async (ticket) => {
  try {
    console.log("📧 [Email] Gửi thông báo ticket mới cho support team...");

    // Lấy danh sách support team members
    const supportMembers = await SupportTeamMember.find({ isActive: true })
      .select('email fullname');

    if (supportMembers.length === 0) {
      console.log("⚠️  [Email] Không có support team members để gửi thông báo");
      return;
    }

    const transporter = await createTransporter();

    // Gửi email cho từng member
    const emailPromises = supportMembers.map(async (member) => {
      const mailOptions = {
        from: `"Hệ thống Support" <${process.env.EMAIL_USER}>`,
        to: member.email,
        subject: `[Ticket Mới] #${ticket.ticketCode} - ${ticket.title}`,
        text: `Xin chào ${member.fullname},

Có ticket mới cần hỗ trợ:
- Mã ticket: ${ticket.ticketCode}
- Tiêu đề: ${ticket.title}
- Ưu tiên: ${ticket.priority}
- Người tạo: ${ticket.creator?.fullname || ticket.creator?.email || 'Unknown'}

Vui lòng đăng nhập hệ thống để xử lý ticket.

Trân trọng,
Hệ thống Support`,
        html: `<p>Xin chào <strong>${member.fullname}</strong>,</p>

<p>Có ticket mới cần hỗ trợ:</p>
<ul>
  <li><strong>Mã ticket:</strong> ${ticket.ticketCode}</li>
  <li><strong>Tiêu đề:</strong> ${ticket.title}</li>
  <li><strong>Ưu tiên:</strong> ${ticket.priority}</li>
  <li><strong>Người tạo:</strong> ${ticket.creator?.fullname || ticket.creator?.email || 'Unknown'}</li>
</ul>

<p>Vui lòng <a href="${process.env.FRONTEND_URL || 'https://admin.sis.wellspring.edu.vn'}/tickets">đăng nhập hệ thống</a> để xử lý ticket.</p>

<p>Trân trọng,<br>Hệ thống Support</p>`
      };

      return transporter.sendMail(mailOptions);
    });

    await Promise.all(emailPromises);
    console.log(`✅ [Email] Đã gửi thông báo ticket mới cho ${supportMembers.length} thành viên support team`);

  } catch (error) {
    console.error("❌ [Email] Lỗi gửi thông báo ticket mới:", error);
  }
};