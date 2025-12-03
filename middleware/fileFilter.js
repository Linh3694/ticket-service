const path = require("path");

/**
 * Shared file filter for upload middleware
 * Validates both MIME type and extension
 * 
 * Supported video formats:
 * - iPhone: MOV, MP4, HEVC (H.265), M4V
 * - Android: MP4, 3GP, WEBM, MKV
 * - Common: MP4, AVI, MOV, WEBM, MKV, WMV, FLV
 */
const fileFilter = (req, file, cb) => {
  // Log file info for debugging
  console.log(`📄 [FileFilter] File: ${file.originalname}, MIME: ${file.mimetype}, Encoding: ${file.encoding}`);
  
  // Comprehensive MIME type regex - images, documents, and all common video formats
  const allowedMimetypes = /^(image\/|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|x-zip-compressed|octet-stream)|text\/plain|video\/)/;
  
  // File extension regex - comprehensive support for iPhone, Android and common video formats
  // Images: jpeg, jpg, png, gif, webp, svg, heic, heif
  // Documents: pdf, doc, docx, txt, zip
  // Videos: mp4, mov, avi, webm, mkv, m4v, 3gp, 3g2, wmv, flv, mpeg, mpg, ts, mts
  const allowedExtensions = /\.(jpeg|jpg|png|gif|webp|svg|heic|heif|pdf|doc|docx|txt|zip|mp4|mov|avi|webm|mkv|m4v|3gp|3g2|wmv|flv|mpeg|mpg|ts|mts)$/i;
  
  const extname = allowedExtensions.test(path.extname(file.originalname));
  const mimetype = allowedMimetypes.test(file.mimetype);

  console.log(`✓ Extension check: ${extname}, MIME check: ${mimetype}`);

  // Allow if either extension or mimetype matches (some devices send incorrect MIME types)
  if (extname || mimetype) {
    return cb(null, true);
  } else {
    console.error(`❌ [FileFilter] Unsupported file: ${file.originalname} (${file.mimetype})`);
    cb(new Error("Loại file không được hỗ trợ. Hỗ trợ: ảnh (jpeg, png, gif, heic), video (mp4, mov, avi, webm, 3gp), tài liệu (pdf, doc, txt)"));
  }
};

module.exports = { fileFilter };

