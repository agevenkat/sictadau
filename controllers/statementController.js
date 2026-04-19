const db = require('../database/db');
const path = require('path');
const fs = require('fs');

const INCOME_TYPES = ['Working Report Payment', 'Artist Payment', 'GW Fund', 'Representative Commission',
  'Office Maintenance', 'Tea, Coffee, Water', 'Transportation', 'Pooja Expenses', 'Salary',
  'Membership Fee', 'Other'];
const PAYMENT_MODES = ['Cash', 'NEFT', 'Cheque', 'Others'];

exports.index = async (req, res) => {
  await db.ready;
  const search = req.query.search || '';
  const type = req.query.type || '';
  const from = req.query.from || '';
  const to = req.query.to || '';

  const totals = await db.prepare(`SELECT
    SUM(CASE WHEN amount_type='Credit' THEN amount ELSE 0 END) as total_credit,
    SUM(CASE WHEN amount_type='Debit' THEN amount ELSE 0 END) as total_debit
    FROM statements`).get();

  const balance = (totals.total_credit || 0) - (totals.total_debit || 0);
  const projects = await db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();

  res.render('statements/index', {
    title: 'Statement', totals, balance,
    search, type, from, to, projects, INCOME_TYPES, PAYMENT_MODES
  });
};

exports.data = async (req, res) => {
  await db.ready;
  try {
    const draw = parseInt(req.query.draw) || 1;
    const start = parseInt(req.query.start) || 0;
    const length = Math.min(parseInt(req.query.length) || 25, 500);
    const searchRaw = req.query.search;
    const search = ((typeof searchRaw === 'object' ? searchRaw?.value : searchRaw) || '').trim();
    const type = req.query.type || '';
    const from = req.query.from || '';
    const to = req.query.to || '';
    const orderArr = Array.isArray(req.query.order) ? req.query.order : [];
    const orderColIdx = parseInt(orderArr[0]?.column) || 0;
    const orderDir = orderArr[0]?.dir === 'desc' ? 'DESC' : 'ASC';
    const colMap = { 0: 's.transaction_date', 1: 's.income_type', 2: 's.paid_to', 3: 'p.film_name', 4: 's.payment_mode', 5: 's.transaction_remarks', 6: 's.amount_type', 7: 's.amount' };
    const orderBy = colMap[orderColIdx] || 's.transaction_date';

    const whereParts = [];
    const filterParams = [];
    if (search) {
      whereParts.push('(s.paid_to LIKE ? OR s.income_type LIKE ? OR s.transaction_remarks LIKE ?)');
      filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (type) { whereParts.push('s.amount_type = ?'); filterParams.push(type); }
    if (from) { whereParts.push('s.transaction_date >= ?'); filterParams.push(from); }
    if (to) { whereParts.push('s.transaction_date <= ?'); filterParams.push(to); }

    const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
    const baseJoin = 'FROM statements s LEFT JOIN projects p ON s.project_id = p.id';

    const batchResults = await db.batch([
      { sql: 'SELECT COUNT(*) as cnt FROM statements', args: [] },
      { sql: `SELECT COUNT(*) as cnt ${baseJoin} ${where}`, args: filterParams },
      { sql: `SELECT s.id, s.transaction_date, s.income_type, s.paid_to, s.payment_mode,
              s.transaction_remarks, s.amount_type, s.amount, s.receipt, p.film_name
       ${baseJoin} ${where} ORDER BY ${orderBy} ${orderDir}, s.id DESC LIMIT ? OFFSET ?`,
        args: [...filterParams, length, start] }
    ]);
    const totalRow    = batchResults[0].first() || { cnt: 0 };
    const filteredRow = batchResults[1].first() || { cnt: 0 };
    const rows        = batchResults[2].rows;

    // Server-side date formatting — immune to client timezone and corrupted values
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function fmtDate(d) {
      if (!d) return '—';
      const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return String(d);
      return `${m[3]}-${MON[parseInt(m[2], 10) - 1]}-${m[1]}`;
    }
    rows.forEach(r => { r.transaction_date_f = fmtDate(r.transaction_date); });

    res.json({ draw, recordsTotal: totalRow.cnt, recordsFiltered: filteredRow.cnt, data: rows });
  } catch (e) {
    console.error('Statements data error:', e.message);
    res.status(500).json({ draw: parseInt(req.query.draw) || 1, recordsTotal: 0, recordsFiltered: 0, data: [], error: e.message });
  }
};

exports.exportCsv = async (req, res) => {
  await db.ready;
  const search = (req.query.search || '').trim();
  const type = req.query.type || '';
  const from = req.query.from || '';
  const to = req.query.to || '';
  const whereParts = [];
  const filterParams = [];
  if (search) {
    whereParts.push('(s.paid_to LIKE ? OR s.income_type LIKE ? OR s.transaction_remarks LIKE ?)');
    filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (type) { whereParts.push('s.amount_type = ?'); filterParams.push(type); }
  if (from) { whereParts.push('s.transaction_date >= ?'); filterParams.push(from); }
  if (to) { whereParts.push('s.transaction_date <= ?'); filterParams.push(to); }
  const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
  const rows = await db.prepare(
    `SELECT s.id, s.transaction_date, s.income_type, s.paid_to, p.film_name,
            s.payment_mode, s.transaction_remarks, s.amount_type, s.amount
     FROM statements s LEFT JOIN projects p ON s.project_id = p.id
     ${where} ORDER BY s.transaction_date DESC, s.id DESC`
  ).all(...filterParams);
  const headers = ['ID', 'Date', 'Income Type', 'Paid To', 'Film Name', 'Payment Mode', 'Remarks', 'Type', 'Amount'];
  const fields = ['id', 'transaction_date', 'income_type', 'paid_to', 'film_name', 'payment_mode', 'transaction_remarks', 'amount_type', 'amount'];
  const csv = [headers.join(','), ...rows.map(r => fields.map(f => JSON.stringify(r[f] ?? '')).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="statements.csv"');
  res.send(csv);
};

exports.create = async (req, res) => {
  await db.ready;
  const data = sanitize(req.body);
  const errors = validate(data);

  if (req.file) data.receipt = '/uploads/' + req.file.filename;

  if (errors.length) {
    if (req.file) deleteFile(req.file.path);
    req.flash('error', errors.join(' '));
    return res.redirect('/statements');
  }

  await db.prepare(`INSERT INTO statements
    (transaction_date, income_type, paid_to, project_id, payment_mode, transaction_remarks, amount_type, amount, receipt)
    VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    data.transaction_date, data.income_type, data.paid_to, data.project_id,
    data.payment_mode, data.transaction_remarks, data.amount_type, data.amount, data.receipt
  );

  req.flash('success', 'Transaction recorded.');
  res.redirect('/statements');
};

exports.show = async (req, res) => {
  await db.ready;
  const stmt = await db.prepare(`SELECT s.*, p.film_name FROM statements s
    LEFT JOIN projects p ON s.project_id = p.id WHERE s.id = ?`).get(req.params.id);
  if (!stmt) { req.flash('error', 'Entry not found.'); return res.redirect('/statements'); }
  res.render('statements/show', { title: 'Receipt', stmt, layout: false });
};

exports.destroy = async (req, res) => {
  await db.ready;
  const stmt = await db.prepare('SELECT * FROM statements WHERE id = ?').get(req.params.id);
  if (!stmt) { req.flash('error', 'Entry not found.'); return res.redirect('/statements'); }
  if (stmt.receipt) deleteFile(path.join('./public', stmt.receipt));
  await db.prepare('DELETE FROM statements WHERE id = ?').run(stmt.id);
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
