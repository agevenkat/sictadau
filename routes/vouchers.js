const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.get('/', voucherController.index);
router.get('/data', voucherController.data);
router.get('/export', voucherController.exportCsv);
router.post('/export-selected', voucherController.exportSelected);
router.get('/check-duplicate', voucherController.checkDuplicate);
router.get('/create', voucherController.showCreate);
router.post('/', voucherController.create);
router.get('/:id/show', voucherController.show);
router.get('/:id', voucherController.show); // Direct access to voucher detail/slip
router.get('/:id/edit', voucherController.showEdit);
router.put('/:id', voucherController.update);
router.post('/:id/pay', voucherController.markPaid);
router.delete('/:id', requireAdmin, voucherController.destroy);

module.exports = router;
