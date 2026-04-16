const db = require('../database/db');
const path = require('path');
const fs = require('fs');

const INCOME_TYPES = ['Artist Payment', 'GW Fund', 'Representative Commission', 'Office Maintenance',
  'Tea, Coffee, Water', 'Transportation', 'Pooja Expenses', 'Salary', 'Membership Fee', 'Other'];
const PAYMENT_MODES = ['Cash', 'NEFT', 'Cheque', 'Others'];

exports.index = (req, res) => {
  const search = req.query.search || '';
  const type = req.query.type || '';
  const from = req.query.from || '';
  const to = req.query.to || '';

  let query = `SELECT s.*, p.film_name FROM statements s
               LEFT JOIN projects p ON s.project_id = p.id WHERE 1=1`;
  const params = [];

  if (search) {
    query += ` AND (s.paid_to LIKE ? OR s.income_type LIKE ? OR s.transaction_remarks LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (type) { query += ` AND s.amount_type = ?`; params.push(type); }
  if (from) { query += ` AND s.transaction_date >= ?`; params.push(from); }
  if (to) { query += ` AND s.transaction_date <= ?`; params.push(to); }
  query += ' ORDER BY s.transaction_date DESC, s.id DESC';

  const statements = db.prepare(query).all(...params);

  const totals = db.prepare(`SELECT
    SUM(CASE WHEN amount_type='Credit' THEN amount ELSE 0 END) as total_credit,
    SUM(CASE WHEN amount_type='Debit' THEN amount ELSE 0 END) as total_debit
    FROM statements`).get();

  const balance = (totals.total_credit || 0) - (totals.total_debit || 0);
  const projects = db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();

  res.render('statements/index', {
    title: 'Statement', statements, totals, balance,
    search, type, from, to, projects, INCOME_TYPES, PAYMENT_MODES
  });
};

exports.create = (req, res) => {
  const data = sanitize(req.body);
  const errors = validate(data);

  if (req.file) data.receipt = '/uploads/' + req.file.filename;

  if (errors.length) {
    if (req.file) deleteFile(req.file.path);
    req.flash('error', errors.join(' '));
    return res.redirect('/statements');
  }

  db.prepare(`INSERT INTO statements
    (transaction_date, income_type, paid_to, project_id, payment_mode, transaction_remarks, amount_type, amount, receipt)
    VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    data.transaction_date, data.income_type, data.paid_to, data.project_id,
    data.payment_mode, data.transaction_remarks, data.amount_type, data.amount, data.receipt
  );

  req.flash('success', 'Transaction recorded.');
  res.redirect('/statements');
};

exports.show = (req, res) => {
  const stmt = db.prepare(`SELECT s.*, p.film_name FROM statements s
    LEFT JOIN projects p ON s.project_id = p.id WHERE s.id = ?`).get(req.params.id);
  if (!stmt) { req.flash('error', 'Entry not found.'); return res.redirect('/statements'); }
  res.render('statements/show', { title: 'Receipt', stmt, layout: false });
};

exports.destroy = (req, res) => {
  const stmt = db.prepare('SELECT * FROM statements WHERE id = ?').get(req.params.id);
  if (!stmt) { req.flash('error', 'Entry not found.'); return res.redirect('/statements'); }
  if (stmt.receipt) deleteFile(path.join('./public', stmt.receipt));
  db.prepare('DELETE FROM statements WHERE id = ?').run(stmt.id);
  req.flash('success', 'Entry deleted.');
  res.redirect('/statements');
};

function sanitize(body) {
  return {
    transaction_date: body.transaction_date || new Date().toISOString().split('T')[0],
    income_type: (body.income_type || '').trim() || null,
    paid_to: (body.paid_to || '').trim() || null,
    project_id: body.project_id ? parseInt(body.project_id) : null,
    payment_mode: body.payment_mode || 'Cash',
    transaction_remarks: (body.transaction_remarks || '').trim() || null,
    amount_type: body.amount_type || 'Debit',
    amount: parseFloat(body.amount) || 0,
    receipt: null
  };
}

function validate(data) {
  const errors = [];
  if (!data.transaction_date) errors.push('Date is required.');
  if (data.amount <= 0) errors.push('Amount must be greater than 0.');
  if (!['Debit', 'Credit'].includes(data.amount_type)) errors.push('Invalid type.');
  return errors;
}

function deleteFile(fp) { try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {} }
