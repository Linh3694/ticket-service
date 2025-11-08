const path = require("path");

/**
 * Shared file filter for upload middleware
 * Validates both MIME type and extension
 */
const fileFilter = (req, file, cb) => {
  // Log file info for debugging
  console.log(`📄 [FileFilter] File: ${file.originalname}, MIME: ${file.mimetype}, Encoding: ${file.encoding}`);
  
  // More comprehensive MIME type regex - accept all common image types and more
  // For messages, we primarily care about images
  const allowedMimetypes = /^(image\/|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|x-zip-compressed)|text\/plain|video\/)/;
  // File extension regex
  const allowedExtensions = /\.(jpeg|jpg|png|gif|webp|svg|pdf|doc|docx|txt|zip|mp4|avi|mov|webm|mkv)$/i;
  
  const extname = allowedExtensions.test(path.extname(file.originalname));
  const mimetype = allowedMimetypes.test(file.mimetype);

  console.log(`✓ Extension check: ${extname}, MIME check: ${mimetype}`);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    console.error(`❌ [FileFilter] Unsupported file: ${file.originalname} (${file.mimetype})`);
    cb(new Error("Loại file không được hỗ trợ"));
  }
};

module.exports = { fileFilter };

