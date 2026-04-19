const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const memberController = require('../controllers/memberController');
const { requireAuth } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './public/uploads'),
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

router.use(requireAuth);
router.get('/', memberController.index);
router.get('/data', memberController.data);
router.get('/export', memberController.exportCsv);
router.get('/create', memberController.showCreate);
router.post('/', upload.single('profile_picture'), memberController.create);
router.get('/:id', memberController.show);
router.get('/:id/edit', memberController.showEdit);
router.put('/:id', upload.single('profile_picture'), memberController.update);
router.delete('/:id', memberController.destroy);

module.exports = router;
