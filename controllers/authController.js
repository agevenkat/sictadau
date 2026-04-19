const bcrypt = require('bcryptjs');
const db = require('../database/db');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

exports.showLogin = (req, res) => {
  res.render('auth/login', { title: 'Login — SICTADAU', layout: false });
};

exports.login = async (req, res) => {
  await db.ready;
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/auth/login');
  }

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());

  const dummyHash = '$2b$12$invalid.hash.for.timing.attack.prevention.only';
  const passwordToCheck = user ? user.password : dummyHash;

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
        await db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
          .run(newFailed, lockedUntil, user.id);
        req.flash('error', `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
      } else {
        await db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(newFailed, user.id);
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

  await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = ?')
    .run(user.id);

  const doLogin = () => {
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;
    if (req.session.save) {
      req.session.save(() => res.redirect('/dashboard'));
    } else {
      res.redirect('/dashboard');
    }
  };

  if (typeof req.session.regenerate === 'function') {
    req.session.regenerate((err) => {
      if (err) {
        req.flash('error', 'Session error. Please try again.');
        return res.redirect('/auth/login');
      }
      doLogin();
    });
  } else {
    req.session = {};
    doLogin();
  }
};

exports.logout = (req, res) => {
  const clearAndRedirect = () => {
    res.clearCookie('sictadau.sid');
    res.redirect('/auth/login');
  };
  if (typeof req.session.destroy === 'function') {
    req.session.destroy(clearAndRedirect);
  } else {
    req.session = null;
    clearAndRedirect();
  }
};
