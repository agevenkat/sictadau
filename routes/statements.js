const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const statementController = require('../controllers/statementController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
    cb(null, `receipt_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only PDF and image files allowed.'));
  }
});

// Wrap upload so errors flash instead of crashing
function uploadReceipt(req, res, next) {
  upload.single('receipt')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Receipt upload failed.');
    next();
  });
}

router.use(requireAuth);
router.get('/', statementController.index);
router.get('/data', statementController.data);
router.get('/export', statementController.exportCsv);
router.post('/', uploadReceipt, statementController.create);
router.get('/:id/receipt', statementController.show);
router.delete('/:id', requireAdmin, statementController.destroy);

module.exports = router;
