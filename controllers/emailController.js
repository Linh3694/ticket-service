// /backend/controllers/emailController.js
const nodemailer = require("nodemailer");
const { ClientSecretCredential } = require("@azure/identity");
const { Client } = require("@microsoft/microsoft-graph-client");
const { TokenCredentialAuthenticationProvider } = require("@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials");
const Ticket = require("../../models/Ticket");
const User = require("../../models/Users");
const { v4: uuidv4 } = require("uuid");
const ticketController = require("./ticketController");
const { convert } = require('html-to-text'); // Added import for html-to-text

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

// B) Hàm đọc email từ inbox và tạo ticket (dùng Microsoft Graph API)
exports.fetchEmailsAndCreateTickets = async (req, res) => {
  try {

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
        return;
        }
    console.log(`Tìm thấy ${messages.value.length} email chưa đọc`);

    for (let msg of messages.value) {
      const subject = msg.subject || "Email Support";
      const from = msg.from?.emailAddress?.address || "";
      const content = msg.body?.content || "";
      const lowerSubject = subject.trim().toLowerCase();
      if (lowerSubject.startsWith("re:") || lowerSubject.startsWith("trả lời:")) {
        console.log(`Bỏ qua email có subject: ${subject}`);
         await graphClient
          .api(`/users/${userEmail}/messages/${msg.id}`)
          .update({ isRead: true });
        continue;
        }
 
      const plainContent = convert(content, { wordwrap: 130 }); // Updated to use html-to-text

      // Kiểm tra domain của người gửi
      if (!from.endsWith("@wellspring.edu.vn")) {
        console.log(`Bỏ qua email từ ${from} vì không thuộc domain @wellspring.edu.vn`);
        // Đánh dấu email là đã đọc để không xử lý lại
        await graphClient
          .api(`/users/${userEmail}/messages/${msg.id}`)
          .update({ isRead: true });
        console.log(`Đã đánh dấu email ${msg.id} là đã đọc (bỏ qua)`);
        continue; // Bỏ qua email này
      }

      console.log("Đang xử lý email từ:", from, "với tiêu đề:", subject);
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
        console.log(`Không tìm thấy user với email ${from}, tạo user tạm thời...`);
        creatorUser = await User.create({
          email: from,
          fullname: from.split("@")[0], // Lấy phần trước @ làm tên tạm
          role: "user", // Gán role mặc định
          password: "temporaryPassword", // Mật khẩu tạm (nên mã hóa trong thực tế)
        });
        console.log("Đã tạo user tạm:", creatorUser._id);
      }

        const newTicket = await ticketController.createTicketHelper({
            title: subject,
            description: plainContent,
            creatorId: creatorUser._id,
            priority: "Medium",
            files: attachments,  // Email ko có file attach tạm
            });


      // Đánh dấu email là đã đọc
      await graphClient
        .api(`/users/${userEmail}/messages/${msg.id}`)
        .update({ isRead: true });
      console.log(`Đã đánh dấu email ${msg.id} là đã đọc`);
    }

    return res.status(200).json({ success: true, message: "Đã xử lý email và tạo ticket." });
  } catch (error) {
    console.error("Lỗi khi fetch email:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// C) Hàm chạy định kỳ (dùng với cron job nếu cần)
exports.runEmailSync = async () => {
  try {
    await exports.fetchEmailsAndCreateTickets({}); // Gọi hàm fetch mà không cần req/res
  } catch (error) {
    console.error("Lỗi đồng bộ email:", error);
  }
};