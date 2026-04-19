const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const memberController = require('../controllers/memberController');
const { requireAuth } = require('../middleware/auth');

// On Vercel only /tmp is writable; locally use public/uploads
const IS_VERCEL = process.env.VERCEL === '1';
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, '../public/uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `member_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only image files allowed (jpg, png, webp).'));
  }
});

// Wrap upload so errors flash instead of crashing the request
function uploadPhoto(req, res, next) {
  upload.single('profile_picture')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Photo upload failed.');
    next(); // continue to controller without req.file — other fields are still saved
  });
}

router.use(requireAuth);
router.get('/', memberController.index);
router.get('/data', memberController.data);
router.get('/export', memberController.exportCsv);
router.get('/create', memberController.showCreate);
router.post('/', uploadPhoto, memberController.create);
router.get('/:id', memberController.show);
router.get('/:id/edit', memberController.showEdit);
router.put('/:id', uploadPhoto, memberController.update);
router.delete('/:id', memberController.destroy);

module.exports = router;
