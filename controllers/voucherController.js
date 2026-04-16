const db = require('../database/db');

const CHARACTERS = ['Hero', 'Heroine', 'Supporting', 'Bit Voice', 'Comedian', 'Villain', 'Character Artist', 'Other'];
const GW_PERCENT = 5;

exports.index = (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';
  const project_id = req.query.project_id || '';

  let query = `SELECT v.*, m.full_name, m.membership_no, m.bank_account_no, m.ifsc_code, m.bank_name,
               p.film_name, r.name as rep_name
               FROM vouchers v
               JOIN members m ON v.member_id = m.id
               JOIN projects p ON v.project_id = p.id
               LEFT JOIN representatives r ON v.representative_id = r.id
               WHERE 1=1`;
  const params = [];

  if (search) {
    query += ` AND (m.full_name LIKE ? OR m.membership_no LIKE ? OR p.film_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { query += ` AND v.status = ?`; params.push(status); }
  if (project_id) { query += ` AND v.project_id = ?`; params.push(parseInt(project_id)); }
  query += ' ORDER BY v.created_at DESC';

  const vouchers = db.prepare(query).all(...params);
  const stats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(final_amount) as total_final,
    SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid,
    SUM(CASE WHEN status='Paid' THEN final_amount ELSE 0 END) as paid_amount
    FROM vouchers`).get();

  const projects = db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();
  res.render('vouchers/index', { title: 'Artist Vouchers', vouchers, stats, search, status, project_id, projects });
};

exports.showCreate = (req, res) => {
  const members = db.prepare("SELECT id, membership_no, full_name FROM members WHERE status='Active' ORDER BY CAST(membership_no AS INTEGER)").all();
  const projects = db.prepare("SELECT id, film_name, representative_id FROM projects WHERE status != 'Paid' ORDER BY film_name").all();
  const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
  const preProject = req.query.project_id ? parseInt(req.query.project_id) : null;

  // ✅ AUTO-POPULATE: Get representative from selected project
  let preRepresentative = null;
  if (preProject) {
    const project = projects.find(p => p.id === preProject);
    preRepresentative = project?.representative_id || null;
  }

  res.render('vouchers/form', {
    title: 'New Voucher',
    voucher: {
      status: 'Pending',
      gw_fund_percent: GW_PERCENT,
      representative_percent: 5,
      project_id: preProject,
      representative_id: preRepresentative  // ✅ Auto-populated
    },
    members, projects, reps, CHARACTERS, errors: []
  });
};

exports.create = (req, res) => {
  const data = sanitize(req.body);
  const errors = validate(data);

  if (errors.length) {
    const members = db.prepare("SELECT id, membership_no, full_name FROM members WHERE status='Active' ORDER BY CAST(membership_no AS INTEGER)").all();
    const projects = db.prepare("SELECT id, film_name FROM projects ORDER BY film_name").all();
    const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
    return res.render('vouchers/form', { title: 'New Voucher', voucher: data, members, projects, reps, CHARACTERS, errors });
  }

  // Auto-fill representative from project if not set
  if (!data.representative_id) {
    const proj = db.prepare('SELECT representative_id FROM projects WHERE id = ?').get(data.project_id);
    if (proj?.representative_id) data.representative_id = proj.representative_id;
  }

  const result = db.prepare(`INSERT INTO vouchers
    (voucher_type, member_id, project_id, character, representative_id, status,
     amount, gw_fund_percent, gw_fund_amount, representative_percent, representative_amount, final_amount)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    data.voucher_type, data.member_id, data.project_id, data.character,
    data.representative_id, data.status, data.amount,
    data.gw_fund_percent, data.gw_fund_amount, data.representative_percent,
    data.representative_amount, data.final_amount
  );

  req.flash('success', 'Voucher created successfully.');
  if (req.body._action === 'create_close') return res.redirect('/vouchers');
  res.redirect(`/vouchers/${result.lastInsertRowid}`);
};

exports.show = (req, res) => {
  const voucher = db.prepare(`SELECT v.*,
    m.full_name, m.membership_no, m.address, m.email, m.contact_no, m.whatsapp_no,
    m.bank_account_no, m.ifsc_code, m.bank_name,
    p.film_name, p.production_company, p.language, p.place_of_dubbing, p.invoice_no,
    r.name as rep_name
    FROM vouchers v
    JOIN members m ON v.member_id = m.id
    JOIN projects p ON v.project_id = p.id
    LEFT JOIN representatives r ON v.representative_id = r.id
    WHERE v.id = ?`).get(req.params.id);

  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }
  res.render('vouchers/show', { title: `Voucher #${voucher.id}`, voucher, layout: false });
};

exports.showEdit = (req, res) => {
  const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }
  const members = db.prepare("SELECT id, membership_no, full_name FROM members ORDER BY CAST(membership_no AS INTEGER)").all();
  const projects = db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();
  const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
  res.render('vouchers/form', { title: 'Edit Voucher', voucher, members, projects, reps, CHARACTERS, errors: [], isEdit: true });
};

exports.update = (req, res) => {
  const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }

  const data = sanitize(req.body);
  const errors = validate(data);

  if (errors.length) {
    const members = db.prepare("SELECT id, membership_no, full_name FROM members ORDER BY CAST(membership_no AS INTEGER)").all();
    const projects = db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();
    const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
    return res.render('vouchers/form', { title: 'Edit Voucher', voucher: { ...voucher, ...data }, members, projects, reps, CHARACTERS, errors, isEdit: true });
  }

  db.prepare(`UPDATE vouchers SET voucher_type=?, member_id=?, project_id=?, character=?,
    representative_id=?, status=?, amount=?, gw_fund_percent=?, gw_fund_amount=?,
    representative_percent=?, representative_amount=?, final_amount=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`
  ).run(
    data.voucher_type, data.member_id, data.project_id, data.character,
    data.representative_id, data.status, data.amount, data.gw_fund_percent,
    data.gw_fund_amount, data.representative_percent, data.representative_amount,
    data.final_amount, voucher.id
  );

  req.flash('success', 'Voucher updated.');
  res.redirect(`/vouchers/${voucher.id}`);
};

exports.markPaid = (req, res) => {
  const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) {
    req.flash('error', 'Voucher not found.');
    return res.redirect('/vouchers');
  }

  const { payment_method, payment_notes } = req.body;

  // ✅ VALIDATION: payment_method is now REQUIRED
  if (!payment_method) {
    req.flash('error', 'Payment method is required.');
    return res.redirect(`/vouchers/${voucher.id}`);
  }

  // ✅ VALIDATION: Validate payment_method is one of the allowed values
  const ALLOWED_PAYMENT_METHODS = ['Cash', 'Cheque', 'NEFT', 'RTGS', 'Others'];
  if (!ALLOWED_PAYMENT_METHODS.includes(payment_method)) {
    req.flash('error', 'Invalid payment method.');
    return res.redirect(`/vouchers/${voucher.id}`);
  }

  // ✅ VALIDATION: Additional validations based on payment method
  const errors = [];
  if (payment_method === 'Cheque') {
    if (!req.body.cheque_number) errors.push('Cheque number is required');
    if (!req.body.cheque_date) errors.push('Cheque date is required');
  }
  if (['NEFT', 'RTGS'].includes(payment_method)) {
    if (!req.body.transaction_id) errors.push('Transaction ID (UTR) is required');
  }

  if (errors.length > 0) {
    req.flash('error', errors.join('. '));
    return res.redirect(`/vouchers/${voucher.id}`);
  }

  db.prepare(`UPDATE vouchers SET status='Paid', paid_on=CURRENT_TIMESTAMP,
    payment_method=?, payment_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(payment_method, payment_notes || null, voucher.id);

  // Auto-create statement entry
  const member = db.prepare('SELECT full_name FROM members WHERE id = ?').get(voucher.member_id);
  const project = db.prepare('SELECT film_name FROM projects WHERE id = ?').get(voucher.project_id);
  db.prepare(`INSERT INTO statements (transaction_date, income_type, paid_to, project_id, payment_mode, transaction_remarks, amount_type, amount)
    VALUES (date('now'), 'Artist Payment', ?, ?, ?, ?, 'Debit', ?)`
  ).run(
    member?.full_name, voucher.project_id,
    payment_method || 'Others',
    `Voucher #${voucher.id} — ${project?.film_name}`,
    voucher.final_amount
  );

  req.flash('success', 'Voucher marked as paid.');
  const ref = req.get('Referer') || `/vouchers/${voucher.id}`;
  res.redirect(ref);
};

exports.destroy = (req, res) => {
  const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }
  if (voucher.status === 'Paid') {
    req.flash('error', 'Cannot delete a paid voucher.');
    return res.redirect(`/vouchers/${voucher.id}`);
  }
  db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucher.id);
  req.flash('success', 'Voucher deleted.');
  res.redirect('/vouchers');
};

// ---- Helpers ----
function sanitize(body) {
  const amount = parseFloat(body.amount) || 0;
  const gwPct = parseFloat(body.gw_fund_percent) || GW_PERCENT;
  const repPct = parseFloat(body.representative_percent) || 5;
  const gwAmt = parseFloat((amount * gwPct / 100).toFixed(2));
  const repAmt = parseFloat((amount * repPct / 100).toFixed(2));
  const finalAmt = parseFloat((amount - gwAmt - repAmt).toFixed(2));

  return {
    voucher_type: body.voucher_type || 'Artist',
    member_id: parseInt(body.member_id) || null,
    project_id: parseInt(body.project_id) || null,
    character: body.character || null,
    representative_id: body.representative_id ? parseInt(body.representative_id) : null,
    status: body.status || 'Pending',
    amount,
    gw_fund_percent: gwPct,
    gw_fund_amount: gwAmt,
    representative_percent: repPct,
    representative_amount: repAmt,
    final_amount: finalAmt
  };
}

function validate(data) {
  const errors = [];
  if (!data.member_id) errors.push('Member is required.');
  if (!data.project_id) errors.push('Project is required.');
  if (data.amount <= 0) errors.push('Amount must be greater than 0.');
  return errors;
}
