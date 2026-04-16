const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');
const { redirectIfAuth } = require('../middleware/auth');

// Strict rate limit on login — 10 attempts per 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'Too many login attempts. Please wait 15 minutes before trying again.');
    res.redirect('/auth/login');
  }
});

router.get('/login', redirectIfAuth, authController.showLogin);
router.post('/login', redirectIfAuth, loginLimiter, authController.login);
router.post('/logout', authController.logout);

module.exports = router;
