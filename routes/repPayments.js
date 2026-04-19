const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/repPaymentController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);

router.get('/',           ctrl.index);
router.post('/',          ctrl.create);
router.get('/:id/slip',   ctrl.slip);
router.post('/:id/pay',   ctrl.markPaid);
router.delete('/:id',     requireAdmin, ctrl.destroy);

module.exports = router;
