const bcrypt = require('bcrypt');
const db = require('../database/db');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

exports.showLogin = (req, res) => {
  res.render('auth/login', { title: 'Login — SICTADAU' });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/auth/login');
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());

  // Always run bcrypt to prevent timing attacks
  const dummyHash = '$2b$12$invalid.hash.for.timing.attack.prevention.only';
  const passwordToCheck = user ? user.password : dummyHash;

  // Check account lock
  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    req.flash('error', `Account locked. Try again in ${remaining} minute(s).`);
    return res.redirect('/auth/login');
  }

  const valid = await bcrypt.compare(password, passwordToCheck);

  if (!user || !valid) {
    if (user) {
      const newFailed = user.failed_attempts + 1;
      if (newFailed >= MAX_FAILED) {
        const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
          .run(newFailed, lockedUntil, user.id);
        req.flash('error', `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
      } else {
        db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(newFailed, user.id);
        req.flash('error', `Invalid credentials. ${MAX_FAILED - newFailed} attempt(s) remaining.`);
      }
    } else {
      req.flash('error', 'Invalid email or password.');
    }
    return res.redirect('/auth/login');
  }

  if (!user.is_active) {
    req.flash('error', 'Your account has been deactivated. Contact the administrator.');
    return res.redirect('/auth/login');
  }

  // Reset failed attempts and update last login
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = ?')
    .run(user.id);

  // Regenerate session to prevent fixation
  req.session.regenerate((err) => {
    if (err) {
      req.flash('error', 'Session error. Please try again.');
      return res.redirect('/auth/login');
    }
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;
    req.session.save(() => res.redirect('/dashboard'));
  });
};

exports.logout = (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('connect.sid');
    res.redirect('/auth/login');
  });
};
