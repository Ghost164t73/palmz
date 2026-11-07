const multer = require('multer');

const customizationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, fields: 16, parts: 20 },
  fileFilter(req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Reference image must be a JPG, PNG or WebP file'), { status: 400, expose: true }));
  },
}).single('referenceImage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB (Vercel's request body limit is ~4.5MB)
  fileFilter(req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only JPG, PNG or WebP images are allowed'), { status: 400, expose: true }));
  },
});

const uploadProductImages = upload.fields([
  { name: 'images', maxCount: 12 },
  { name: 'image', maxCount: 1 },
]);

module.exports = {
  customizationUpload,
  upload,
  uploadProductImages,
};
