const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const statementController = require('../controllers/statementController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './public/uploads'),
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

router.use(requireAuth);
router.get('/', statementController.index);
router.get('/data', statementController.data);
router.get('/export', statementController.exportCsv);
router.post('/', upload.single('receipt'), statementController.create);
router.get('/:id/receipt', statementController.show);
router.delete('/:id', requireAdmin, statementController.destroy);

module.exports = router;
