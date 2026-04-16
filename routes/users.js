const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAdmin } = require('../middleware/auth');

router.get('/', requireAdmin, userController.index);
router.get('/create', requireAdmin, userController.showCreate);
router.post('/', requireAdmin, userController.create);
router.get('/change-password', (req, res) => res.render('users/change-password', { title: 'Change Password', errors: [] }));
router.post('/change-password', userController.changePassword);
router.get('/:id/edit', requireAdmin, userController.showEdit);
router.put('/:id', requireAdmin, userController.update);
router.delete('/:id', requireAdmin, userController.destroy);

module.exports = router;
