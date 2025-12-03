const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Compression settings từ environment hoặc defaults
 */
const COMPRESSION_CONFIG = {
  // Ảnh
  image: {
    enabled: process.env.COMPRESS_IMAGES !== 'false', // Mặc định bật
    maxWidth: parseInt(process.env.IMAGE_MAX_WIDTH) || 1920,
    maxHeight: parseInt(process.env.IMAGE_MAX_HEIGHT) || 1080,
    quality: parseInt(process.env.IMAGE_QUALITY) || 80, // 1-100
    format: process.env.IMAGE_OUTPUT_FORMAT || 'jpeg', // jpeg, png, webp
  },
  // Video
  video: {
    enabled: process.env.COMPRESS_VIDEOS === 'true', // Mặc định tắt (cần ffmpeg)
    maxWidth: parseInt(process.env.VIDEO_MAX_WIDTH) || 1280,
    crf: parseInt(process.env.VIDEO_CRF) || 28, // Constant Rate Factor: 18-28 (lower = better quality)
    preset: process.env.VIDEO_PRESET || 'fast', // ultrafast, superfast, veryfast, faster, fast, medium, slow
  },
  // Giới hạn kích thước để nén (bytes) - chỉ nén file lớn hơn ngưỡng này
  minSizeToCompress: parseInt(process.env.MIN_SIZE_TO_COMPRESS) || 500 * 1024, // 500KB
};

/**
 * Kiểm tra ffmpeg có được cài đặt không
 */
let ffmpegAvailable = null;
const checkFfmpeg = async () => {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  
  try {
    await execPromise('ffmpeg -version');
    ffmpegAvailable = true;
    console.log('✅ [Compress] FFmpeg available for video compression');
  } catch {
    ffmpegAvailable = false;
    console.log('⚠️ [Compress] FFmpeg not available - video compression disabled');
  }
  return ffmpegAvailable;
};

/**
 * Nén ảnh sử dụng sharp
 */
const compressImage = async (filePath) => {
  const config = COMPRESSION_CONFIG.image;
  
  try {
    const stats = fs.statSync(filePath);
    const originalSize = stats.size;
    
    // Bỏ qua nếu file nhỏ hơn ngưỡng
    if (originalSize < COMPRESSION_CONFIG.minSizeToCompress) {
      console.log(`📸 [Compress] Skipping small image: ${path.basename(filePath)} (${(originalSize / 1024).toFixed(1)}KB)`);
      return { compressed: false, originalSize, newSize: originalSize };
    }

    const ext = path.extname(filePath).toLowerCase();
    const tempPath = filePath + '.tmp';

    // Đọc metadata trước
    const metadata = await sharp(filePath).metadata();
    
    // Tính toán resize
    let sharpInstance = sharp(filePath);
    
    // Resize nếu cần
    if (metadata.width > config.maxWidth || metadata.height > config.maxHeight) {
      sharpInstance = sharpInstance.resize(config.maxWidth, config.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Nén theo format
    if (ext === '.png') {
      sharpInstance = sharpInstance.png({ quality: config.quality, compressionLevel: 9 });
    } else if (ext === '.webp') {
      sharpInstance = sharpInstance.webp({ quality: config.quality });
    } else if (ext === '.gif') {
      // GIF - chỉ resize, không nén (sharp hỗ trợ hạn chế với animated gif)
      sharpInstance = sharpInstance.gif();
    } else {
      // JPEG và các định dạng khác -> convert sang JPEG
      sharpInstance = sharpInstance.jpeg({ quality: config.quality, progressive: true });
    }

    // Lưu vào file tạm
    await sharpInstance.toFile(tempPath);

    // Lấy kích thước mới
    const newStats = fs.statSync(tempPath);
    const newSize = newStats.size;

    // Chỉ giữ file nén nếu nhỏ hơn original
    if (newSize < originalSize) {
      fs.unlinkSync(filePath);
      fs.renameSync(tempPath, filePath);
      
      const savedPercent = ((1 - newSize / originalSize) * 100).toFixed(1);
      console.log(`📸 [Compress] Image compressed: ${path.basename(filePath)} | ${(originalSize / 1024).toFixed(1)}KB -> ${(newSize / 1024).toFixed(1)}KB (-${savedPercent}%)`);
      
      return { compressed: true, originalSize, newSize };
    } else {
      // Xóa file tạm nếu không cần
      fs.unlinkSync(tempPath);
      console.log(`📸 [Compress] Image kept original (compression not effective): ${path.basename(filePath)}`);
      return { compressed: false, originalSize, newSize: originalSize };
    }
  } catch (error) {
    console.error(`❌ [Compress] Error compressing image ${filePath}:`, error.message);
    return { compressed: false, error: error.message };
  }
};

/**
 * Nén video sử dụng ffmpeg
 */
const compressVideo = async (filePath) => {
  const config = COMPRESSION_CONFIG.video;
  
  if (!await checkFfmpeg()) {
    console.log(`🎬 [Compress] Skipping video (ffmpeg not available): ${path.basename(filePath)}`);
    return { compressed: false, reason: 'ffmpeg_not_available' };
  }

  try {
    const stats = fs.statSync(filePath);
    const originalSize = stats.size;
    
    // Bỏ qua nếu file nhỏ hơn 1MB
    if (originalSize < 1 * 1024 * 1024) {
      console.log(`🎬 [Compress] Skipping small video: ${path.basename(filePath)} (${(originalSize / 1024 / 1024).toFixed(2)}MB)`);
      return { compressed: false, originalSize, newSize: originalSize };
    }

    const ext = path.extname(filePath).toLowerCase();
    const tempPath = filePath.replace(ext, '_compressed.mp4');

    // FFmpeg command để nén video
    // -vf scale: resize video
    // -crf: quality (lower = better, 18-28 recommended)
    // -preset: speed vs compression tradeoff
    // -c:a aac: audio codec
    // -b:a 128k: audio bitrate
    const ffmpegCmd = `ffmpeg -i "${filePath}" -vf "scale='min(${config.maxWidth},iw)':'-2'" -c:v libx264 -crf ${config.crf} -preset ${config.preset} -c:a aac -b:a 128k -movflags +faststart -y "${tempPath}"`;

    console.log(`🎬 [Compress] Compressing video: ${path.basename(filePath)}...`);
    
    await execPromise(ffmpegCmd);

    // Lấy kích thước mới
    const newStats = fs.statSync(tempPath);
    const newSize = newStats.size;

    // Chỉ giữ file nén nếu nhỏ hơn 80% original
    if (newSize < originalSize * 0.8) {
      fs.unlinkSync(filePath);
      // Rename với extension mp4 (output luôn là mp4)
      const newFilePath = filePath.replace(ext, '.mp4');
      fs.renameSync(tempPath, newFilePath);
      
      const savedPercent = ((1 - newSize / originalSize) * 100).toFixed(1);
      console.log(`🎬 [Compress] Video compressed: ${path.basename(filePath)} | ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(newSize / 1024 / 1024).toFixed(2)}MB (-${savedPercent}%)`);
      
      return { compressed: true, originalSize, newSize, newPath: newFilePath };
    } else {
      // Xóa file tạm nếu không cần
      fs.unlinkSync(tempPath);
      console.log(`🎬 [Compress] Video kept original (compression not effective): ${path.basename(filePath)}`);
      return { compressed: false, originalSize, newSize: originalSize };
    }
  } catch (error) {
    console.error(`❌ [Compress] Error compressing video ${filePath}:`, error.message);
    return { compressed: false, error: error.message };
  }
};

/**
 * Middleware để nén files sau khi upload
 */
const compressFilesMiddleware = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next();
  }

  const compressionResults = [];

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const filePath = file.path;
    const mimeType = file.mimetype || '';

    try {
      // Nén ảnh
      if (mimeType.startsWith('image/') && COMPRESSION_CONFIG.image.enabled) {
        // Bỏ qua GIF animated và SVG
        if (!mimeType.includes('svg') && !mimeType.includes('gif')) {
          const result = await compressImage(filePath);
          compressionResults.push({ file: file.originalname, type: 'image', ...result });
        }
      }
      // Nén video
      else if (mimeType.startsWith('video/') && COMPRESSION_CONFIG.video.enabled) {
        const result = await compressVideo(filePath);
        compressionResults.push({ file: file.originalname, type: 'video', ...result });
        
        // Cập nhật path nếu video được nén (extension có thể thay đổi sang mp4)
        if (result.newPath) {
          req.files[i].path = result.newPath;
        }
      }
    } catch (error) {
      console.error(`❌ [Compress] Error processing ${file.originalname}:`, error.message);
    }
  }

  // Log tổng kết
  const compressed = compressionResults.filter(r => r.compressed);
  if (compressed.length > 0) {
    const totalSaved = compressed.reduce((sum, r) => sum + (r.originalSize - r.newSize), 0);
    console.log(`✅ [Compress] ${compressed.length}/${req.files.length} files compressed, saved ${(totalSaved / 1024).toFixed(1)}KB total`);
  }

  next();
};

module.exports = { compressFilesMiddleware, compressImage, compressVideo, COMPRESSION_CONFIG };

