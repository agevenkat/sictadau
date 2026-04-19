const bcrypt = require('bcryptjs');
const db = require('../database/db');

const MAX_USERS = 3;
const BCRYPT_ROUNDS = 12;

exports.index = async (req, res) => {
  await db.ready;
  const users = await db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users ORDER BY id').all();
  res.render('users/index', { title: 'User Management', users });
};

exports.showCreate = async (req, res) => {
  await db.ready;
  const row = await db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (row.cnt >= MAX_USERS) {
    req.flash('error', `Maximum of ${MAX_USERS} user accounts allowed.`);
    return res.redirect('/users');
  }
  res.render('users/create', { title: 'New User', formData: {}, errors: [] });
};

exports.create = async (req, res) => {
  await db.ready;
  const row = await db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (row.cnt >= MAX_USERS) {
    req.flash('error', `Maximum of ${MAX_USERS} user accounts allowed.`);
    return res.redirect('/users');
  }

  const { name, email, password, confirm_password, role } = req.body;
  const errors = [];

  if (!name || name.trim().length < 2) errors.push('Name must be at least 2 characters.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email required.');
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirm_password) errors.push('Passwords do not match.');
  if (!['superadmin', 'admin', 'staff'].includes(role)) errors.push('Invalid role.');

  if (password && password.length >= 8) {
    if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter.');
    if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number.');
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email?.trim().toLowerCase());
  if (existing) errors.push('An account with this email already exists.');

  if (errors.length) return res.render('users/create', { title: 'New User', formData: req.body, errors });

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.trim().toLowerCase(), hash, role);

  req.flash('success', `User "${name}" created successfully.`);
  res.redirect('/users');
};

exports.showEdit = async (req, res) => {
  await db.ready;
  const user = await db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(req.params.id);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
  res.render('users/edit', { title: 'Edit User', user, errors: [] });
};

exports.update = async (req, res) => {
  await db.ready;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }

  const { name, email, role, is_active, new_password, confirm_password } = req.body;
  const errors = [];

  if (!name || name.trim().length < 2) errors.push('Name must be at least 2 characters.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email required.');
  if (!['superadmin', 'admin', 'staff'].includes(role)) errors.push('Invalid role.');

  if (user.id === req.session.userId && is_active === '0') {
    errors.push('You cannot deactivate your own account.');
  }

  const duplicate = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email?.trim().toLowerCase(), user.id);
  if (duplicate) errors.push('Email already in use by another account.');

  let newHash = null;
  if (new_password) {
    if (new_password.length < 8) errors.push('New password must be at least 8 characters.');
    if (!/[A-Z]/.test(new_password)) errors.push('New password must contain at least one uppercase letter.');
    if (!/[0-9]/.test(new_password)) errors.push('New password must contain at least one number.');
    if (new_password !== confirm_password) errors.push('New passwords do not match.');
    if (!errors.length) newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  }

  if (errors.length) return res.render('users/edit', { title: 'Edit User', user: { ...user, ...req.body }, errors });

  if (newHash) {
    await db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, password=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name.trim(), email.trim().toLowerCase(), role, is_active === '1' ? 1 : 0, newHash, user.id);
  } else {
    await db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name.trim(), email.trim().toLowerCase(), role, is_active === '1' ? 1 : 0, user.id);
  }

  req.flash('success', 'User updated successfully.');
  res.redirect('/users');
};

exports.destroy = async (req, res) => {
  await db.ready;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
  if (user.id === req.session.userId) {
    req.flash('error', 'You cannot delete your own account.');
    return res.redirect('/users');
  }
  await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  req.flash('success', `User "${user.name}" deleted.`);
  res.redirect('/users');
};

exports.changePassword = async (req, res) => {
  await db.ready;
  const { current_password, new_password, confirm_password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const errors = [];

  const valid = await bcrypt.compare(current_password, user.password);
  if (!valid) errors.push('Current password is incorrect.');
  if (!new_password || new_password.length < 8) errors.push('New password must be at least 8 characters.');
  if (!/[A-Z]/.test(new_password)) errors.push('Must include uppercase letter.');
  if (!/[0-9]/.test(new_password)) errors.push('Must include a number.');
  if (new_password !== confirm_password) errors.push('New passwords do not match.');

  if (errors.length) {
    req.flash('error', errors.join(' '));
    return res.redirect('/users/change-password');
  }

  const hash = await bcrypt.hash(new_password, 12);
  await db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, user.id);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/dashboard');
};
