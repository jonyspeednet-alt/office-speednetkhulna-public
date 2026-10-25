const multer = require('multer');
const sharp = require('sharp');
const path = require('path');

// Configure multer for memory storage to process the image before saving
// S13: hard limits so one request can't fill the 512 MB PM2 heap before auth
// even runs. Multipart bodies are NOT covered by the body-parser 20 MB cap.
const memoryStorage = multer.memoryStorage();
const IMAGE_DECODE_OPTIONS = Object.freeze({ limitInputPixels: 16 * 1024 * 1024, animated: false });
const IMAGE_DECODE_TIMEOUT_SECONDS = 10;
const imageSignatureMatches = (buffer, mime) => {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};
// Verify bytes after Multer's bounded buffering and before any consumer invokes
// a decoder. MIME alone is client-controlled; headers are an additional check,
// not a replacement for patched codecs and decode resource limits.
const storage = {
  _handleFile(req, file, cb) {
    memoryStorage._handleFile(req, file, (err, info) => {
      if (err) return cb(err);
      const mime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
      if (!imageSignatureMatches(info.buffer, mime)) {
        const error = new Error('Image content does not match its declared type');
        error.status = 400;
        return cb(error);
      }
      cb(null, info);
    });
  },
  _removeFile(req, file, cb) { memoryStorage._removeFile(req, file, cb); },
};
// Never stored/served as-is: permit only the supported image MIME types.
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
    if (!ALLOWED_IMAGE_MIME.has(mime)) return cb(new Error('Only JPG/PNG/WebP/GIF images are allowed'), false);
    cb(null, true);
  },
});

const resizeAndSave = (targetDir, prefix, maxDim = 800) => {
  return async (req, res, next) => {
    if (!req.file) {
      return next();
    }

    const filename = `${prefix}-${Date.now()}.webp`;
    const outputPath = path.join(targetDir, filename);

    try {
      // Spread: IMAGE_DECODE_OPTIONS is frozen — a sharp version that
      // mutates its options object would throw on the frozen reference.
      await sharp(req.file.buffer, { ...IMAGE_DECODE_OPTIONS })
        .timeout({ seconds: IMAGE_DECODE_TIMEOUT_SECONDS })
        .resize(maxDim, maxDim, {
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        })
        .toFormat('webp', { quality: 80 })
        .toFile(outputPath);

      // Attach the new filename to the request body for the controller
      req.body.imageFilename = filename;
      next();
    } catch (error) {
      console.error('Image processing error:', error);
      next(error);
    }
  };
};

module.exports = {
  upload,
  resizeAndSave,
  IMAGE_DECODE_OPTIONS,
  IMAGE_DECODE_TIMEOUT_SECONDS,
  imageSignatureMatches,
};
