const multer = require('multer');
const path = require('path');

// Configure storage for message files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Match mobile client path expectation for message images
    cb(null, 'uploads/Messages/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'msg-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter for messages (mainly images)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed for messages'), false);
  }
};

const uploadMessage = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

module.exports = uploadMessage; 