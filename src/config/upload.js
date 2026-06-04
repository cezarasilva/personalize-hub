const multer = require('multer');
const path = require('path');

const UPLOAD_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const UPLOAD_ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (UPLOAD_ALLOWED_MIME.has(file.mimetype) && UPLOAD_ALLOWED_EXT.has(ext)) {
            return cb(null, true);
        }
        cb(new Error('Tipo de arquivo não permitido. Envie uma imagem JPEG, PNG, WebP ou GIF.'));
    }
});

module.exports = { upload, UPLOAD_ALLOWED_MIME, UPLOAD_ALLOWED_EXT };
