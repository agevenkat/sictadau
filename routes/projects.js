const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// On Vercel only /tmp is writable; locally use public/uploads (served as static)
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
    cb(null, `project_${Date.now()}_${file.fieldname}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, JPG, JPEG, PNG'));
  }
});

// Wrap upload.fields() so multer errors flash and redirect instead of crashing
const uploadFields = (req, res, next) => {
  upload.fields([
    { name: 'representative_form', maxCount: 1 },
    { name: 'working_report_file', maxCount: 1 }
  ])(req, res, (err) => {
    if (!err) return next();
    let msg = 'File upload failed.';
    if (err instanceof multer.MulterError) {
      msg = err.code === 'FILE_TOO_LARGE' ? 'File too large (max 10MB).'
          : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files.'
          : `Upload error: ${err.message}`;
    } else if (err && err.message) {
      msg = err.message;
    }
    req.flash('error', msg);
    // Redirect back to the originating form
    if (req.params.id) return res.redirect(`/projects/${req.params.id}/edit`);
    return res.redirect('/projects/create');
  });
};

router.use(requireAuth);
router.get('/', projectController.index);
router.get('/data', projectController.data);
router.get('/export', projectController.exportCsv);
router.get('/representatives', requireAdmin, projectController.repsIndex);
router.post('/representatives', requireAdmin, projectController.repCreate);
router.delete('/representatives/:id', requireAdmin, projectController.repDestroy);
router.get('/create', projectController.showCreate);
router.post('/', uploadFields, projectController.create);
router.get('/:id/invoice', projectController.invoice);
router.get('/:id/download-invoice', projectController.downloadInvoice);
router.get('/:id', projectController.show);
router.get('/:id/edit', projectController.showEdit);
router.put('/:id', uploadFields, projectController.update);
router.delete('/:id', requireAdmin, projectController.destroy);
router.post('/:id/payments', projectController.addPayment);

module.exports = router;
