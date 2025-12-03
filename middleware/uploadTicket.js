const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { fileFilter } = require("./fileFilter");
const { compressFilesMiddleware } = require("./compressFiles");

// Định nghĩa đường dẫn thư mục upload
const uploadDir = "uploads/Tickets";

// Kiểm tra và tạo thư mục nếu chưa tồn tại
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Cấu hình storage để lưu file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // Lưu file vào thư mục đã kiểm tra
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

// Cấu hình upload: tối đa 15 file, mỗi file 50MB trước khi nén (như config.env.example)
// File sẽ được nén sau khi upload nên cho phép upload file lớn hơn
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB default (sẽ nén sau)
    files: 15 // Max 15 files
  },
  fileFilter: (req, file, cb) => {
    console.log(`📤 [Upload] File: ${file.originalname}, MIME: ${file.mimetype}`);
    fileFilter(req, file, cb);
  },
});

// Middleware để handle errors
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File quá lớn. Kích thước tối đa: ${process.env.MAX_FILE_SIZE || '50MB'}`
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Quá nhiều file. Tối đa 15 file được phép.'
      });
    }
  }

  if (error.message.includes('Chỉ chấp nhận file')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  next(error);
};

module.exports = { upload, handleUploadError, compressFilesMiddleware };