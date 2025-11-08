const path = require("path");

/**
 * Shared file filter for upload middleware
 * Validates both MIME type and extension
 */
const fileFilter = (req, file, cb) => {
  // Proper MIME type regex
  const allowedMimetypes = /image\/(jpeg|jpg|png|gif)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|x-zip-compressed)|text\/plain|video\/(mp4|x-msvideo|quicktime)/;
  // File extension regex
  const allowedExtensions = /\.jpeg|\.jpg|\.png|\.gif|\.pdf|\.doc|\.docx|\.txt|\.zip|\.mp4|\.avi|\.mov$/i;
  
  const extname = allowedExtensions.test(path.extname(file.originalname));
  const mimetype = allowedMimetypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error("Loại file không được hỗ trợ"));
  }
};

module.exports = { fileFilter };

