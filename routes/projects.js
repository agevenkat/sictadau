const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Ensure uploads directory exists
const uploadsDir = './public/uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
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

const fields = upload.fields([
  { name: 'representative_form', maxCount: 1 },
  { name: 'working_report_file', maxCount: 1 }
]);

// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      req.flash('error', 'File size exceeds 10MB limit.');
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      req.flash('error', 'Too many files uploaded.');
    } else {
      req.flash('error', `Upload error: ${err.message}`);
    }
  } else if (err) {
    req.flash('error', err.message || 'File upload failed.');
  }

  if (req.baseUrl.includes('create') && req.method === 'POST') {
    return res.redirect('/projects/create');
  } else if (req.params.id && req.method === 'PUT') {
    return res.redirect(`/projects/${req.params.id}/edit`);
  }
  next(err);
};

router.use(requireAuth);
router.get('/', projectController.index);
router.get('/representatives', requireAdmin, projectController.repsIndex);
router.post('/representatives', requireAdmin, projectController.repCreate);
router.delete('/representatives/:id', requireAdmin, projectController.repDestroy);
router.get('/create', projectController.showCreate);
router.post('/', fields, handleMulterError, projectController.create);
router.get('/:id/invoice', projectController.invoice);
router.get('/:id/download-invoice', projectController.downloadInvoice);
router.get('/:id', projectController.show);
router.get('/:id/edit', projectController.showEdit);
router.put('/:id', fields, handleMulterError, projectController.update);
router.delete('/:id', requireAdmin, projectController.destroy);
router.post('/:id/payments', projectController.addPayment);

module.exports = router;
