const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure storage for ticket attachments
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Determine destination based on context
    let destFolder = 'uploads/Tickets/temp'; // Default: temporary folder
    
    // If ticketId is provided (update scenario), use ticket folder
    if (req.params.ticketId) {
      destFolder = `uploads/Tickets/${req.params.ticketId}`;
    }
    // For create, we'll use temp folder and move later
    
    // Create folder if it doesn't exist
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }
    
    cb(null, destFolder);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/zip'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

module.exports = upload;
