const express = require('express');
const authMiddleware = require('../auth/authMiddleware');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const {
  uploadImageController,
  transformImageController,
  getImageController,
  deleteImageController,
  listImagesController,
} = require('./imageController');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Upload limiter: stricter limits for file uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 upload requests per minute
  message: { error: 'Too many uploads, please try again later.' },
});

// Routes for images
router.get('/', authMiddleware, listImagesController);
router.get('/:id', getImageController);
router.post(
  '/upload',
  authMiddleware,
  uploadLimiter,
  upload.single('image'),
  uploadImageController,
);
router.post('/transform/:id', authMiddleware, transformImageController);
router.get(
  '/download/:id',
  require('./imageController').downloadImageController,
);
router.delete('/:id', authMiddleware, deleteImageController);

module.exports = router;
