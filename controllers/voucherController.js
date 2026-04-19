const db = require('../database/db');

const CHARACTERS = ['Hero', 'Heroine', 'Supporting', 'Bit Voice', 'Comedian', 'Villain', 'Character Artist', 'Other'];
const GW_PERCENT = 5;

exports.index = async (req, res) => {
  await db.ready;
  const search = req.query.search || '';
  const status = req.query.status || '';
  const project_id = req.query.project_id || '';
  const from = req.query.from || '';
  const to = req.query.to || '';
  const stats = await db.prepare(`SELECT
    COUNT(*) as total,
    SUM(final_amount) as total_final,
    SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid,
    SUM(CASE WHEN status='Paid' THEN final_amount ELSE 0 END) as paid_amount
    FROM vouchers`).get();
  const projects = await db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();
  res.render('vouchers/index', { title: 'Artist Vouchers', stats, search, status, project_id, from, to, projects });
};

exports.data = async (req, res) => {
  await db.ready;
  try {
    const draw = parseInt(req.query.draw) || 1;
    const start = parseInt(req.query.start) || 0;
    const length = Math.min(parseInt(req.query.length) || 25, 500);
    const searchRaw = req.query.search;
    const search = ((typeof searchRaw === 'object' ? searchRaw?.value : searchRaw) || '').trim();
    const status = req.query.status || '';
    const project_id = req.query.project_id || '';
    const from = req.query.from || '';
    const to = req.query.to || '';
    const orderArr = Array.isArray(req.query.order) ? req.query.order : [];
    const orderColIdx = parseInt(orderArr[0]?.column) || 0;
    const orderDir = orderArr[0]?.dir === 'desc' ? 'DESC' : 'ASC';
    // col 0 = checkbox (orderable:false), col 1 = date, col 2 = artist ...
    const colMap = { 1: 'COALESCE(v.voucher_date, v.created_at)', 2: 'm.full_name', 3: 'p.film_name', 4: 'm.bank_account_no', 5: 'm.ifsc_code', 6: 'm.bank_name', 7: 'v.final_amount', 8: 'v.status' };
    const orderBy = colMap[orderColIdx] || 'COALESCE(v.voucher_date, v.created_at)';

    const whereParts = [];
    const filterParams = [];
    if (search) {
      whereParts.push('(m.full_name LIKE ? OR m.membership_no LIKE ? OR p.film_name LIKE ?)');
      filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) { whereParts.push('v.status = ?'); filterParams.push(status); }
    if (project_id) { whereParts.push('v.project_id = ?'); filterParams.push(parseInt(project_id)); }
    if (from) { whereParts.push('COALESCE(v.voucher_date, date(v.created_at)) >= ?'); filterParams.push(from); }
    if (to) { whereParts.push('COALESCE(v.voucher_date, date(v.created_at)) <= ?'); filterParams.push(to); }

    const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
    const baseJoin = `FROM vouchers v
      JOIN members m ON v.member_id = m.id
      JOIN projects p ON v.project_id = p.id
      LEFT JOIN representatives r ON v.representative_id = r.id`;

    const batchResults = await db.batch([
      { sql: 'SELECT COUNT(*) as cnt FROM vouchers', args: [] },
      { sql: `SELECT COUNT(*) as cnt ${baseJoin} ${where}`, args: filterParams },
      { sql: `SELECT v.id, v.member_id, v.project_id, v.status, v.final_amount,
              COALESCE(v.voucher_date, date(v.created_at)) AS voucher_date, v.created_at,
              m.full_name, m.membership_no, m.bank_account_no, m.ifsc_code, m.bank_name,
              m.whatsapp_no, m.contact_no, p.film_name
       ${baseJoin} ${where} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`,
        args: [...filterParams, length, start] }
    ]);
    const totalRow    = batchResults[0].first() || { cnt: 0 };
    const filteredRow = batchResults[1].first() || { cnt: 0 };
    const rows        = batchResults[2].rows;

    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function fmtDate(d) {
      if (!d) return '—';
      const s = String(d);
      const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return s;
      return `${m[3]}-${MON[parseInt(m[2], 10) - 1]}-${m[1]}`;
    }
    rows.forEach(r => {
      // Show voucher_date if set, fall back to created_at
      const dateVal = r.voucher_date || r.created_at;
      r.created_at_f = fmtDate(dateVal);
    });

    res.json({ draw, recordsTotal: totalRow.cnt, recordsFiltered: filteredRow.cnt, data: rows });
  } catch (e) {
    console.error('Vouchers data error:', e.message);
    res.status(500).json({ draw: parseInt(req.query.draw) || 1, recordsTotal: 0, recordsFiltered: 0, data: [], error: e.message });
  }
};

exports.exportCsv = async (req, res) => {
  await db.ready;
  const search = (req.query.search || '').trim();
  const status = req.query.status || '';
  const project_id = req.query.project_id || '';
  const from = req.query.from || '';
  const to = req.query.to || '';
  const whereParts = [];
  const filterParams = [];
  if (search) {
    whereParts.push('(m.full_name LIKE ? OR m.membership_no LIKE ? OR p.film_name LIKE ?)');
    filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { whereParts.push('v.status = ?'); filterParams.push(status); }
  if (project_id) { whereParts.push('v.project_id = ?'); filterParams.push(parseInt(project_id)); }
  if (from) { whereParts.push('COALESCE(v.voucher_date, date(v.created_at)) >= ?'); filterParams.push(from); }
  if (to) { whereParts.push('COALESCE(v.voucher_date, date(v.created_at)) <= ?'); filterParams.push(to); }
  const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
  const rows = await db.prepare(
    `SELECT v.id, m.membership_no, m.full_name, p.film_name, v.amount, v.gw_fund_amount,
            v.representative_amount, v.final_amount, v.status, v.payment_method, v.paid_on,
            m.bank_account_no, m.ifsc_code, m.bank_name, v.created_at
     FROM vouchers v
     JOIN members m ON v.member_id = m.id
     JOIN projects p ON v.project_id = p.id
     LEFT JOIN representatives r ON v.representative_id = r.id
     ${where} ORDER BY v.created_at DESC`
  ).all(...filterParams);
  const headers = ['ID', 'Membership No', 'Artist Name', 'Film Name', 'Amount', 'GW Fund', 'Rep Commission', 'Final Amount', 'Status', 'Payment Method', 'Paid On', 'Account No', 'IFSC', 'Bank', 'Created At'];
  const fields = ['id', 'membership_no', 'full_name', 'film_name', 'amount', 'gw_fund_amount', 'representative_amount', 'final_amount', 'status', 'payment_method', 'paid_on', 'bank_account_no', 'ifsc_code', 'bank_name', 'created_at'];
  const csv = [headers.join(','), ...rows.map(r => fields.map(f => JSON.stringify(r[f] ?? '')).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="vouchers.csv"');
  res.send(csv);
};

exports.exportSelected = async (req, res) => {
  await db.ready;
  let ids = [];
  try { ids = JSON.parse(req.body.ids || '[]'); } catch (_) {}
  ids = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) {
    req.flash('error', 'No vouchers selected.');
    return res.redirect('/vouchers');
  }
  // Limit to 5000 IDs to prevent abuse
  ids = ids.slice(0, 5000);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT v.id, m.membership_no, m.full_name, p.film_name,
            COALESCE(v.voucher_date, date(v.created_at)) AS voucher_date,
            v.amount, v.gw_fund_amount, v.representative_amount, v.final_amount,
            v.status, v.payment_method, v.paid_on,
            m.bank_account_no, m.ifsc_code, m.bank_name
     FROM vouchers v
     JOIN members m ON v.member_id = m.id
     JOIN projects p ON v.project_id = p.id
     WHERE v.id IN (${placeholders})
     ORDER BY v.voucher_date DESC, v.id`
  ).all(...ids);
  const headers = ['ID', 'Membership No', 'Artist Name', 'Film Name', 'Voucher Date',
                   'Amount', 'GW Fund', 'Rep Commission', 'Final Amount',
                   'Status', 'Payment Method', 'Paid On', 'Account No', 'IFSC', 'Bank'];
  const fields  = ['id', 'membership_no', 'full_name', 'film_name', 'voucher_date',
                   'amount', 'gw_fund_amount', 'representative_amount', 'final_amount',
                   'status', 'payment_method', 'paid_on', 'bank_account_no', 'ifsc_code', 'bank_name'];
  const csv = [headers.join(','), ...rows.map(r => fields.map(f => JSON.stringify(r[f] ?? '')).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="vouchers-selected-${ids.length}.csv"`);
  res.send(csv);
};

exports.checkDuplicate = async (req, res) => {
  await db.ready;
  const member_id = parseInt(req.query.member_id);
  const project_id = parseInt(req.query.project_id);
  const exclude_id = parseInt(req.query.exclude_id) || 0;
  if (!member_id || !project_id) return res.json({ exists: false, count: 0, vouchers: [] });
  const rows = await db.prepare(
    `SELECT v.id, v.status, v.final_amount, COALESCE(v.voucher_date, date(v.created_at)) as vdate
     FROM vouchers v WHERE v.member_id = ? AND v.project_id = ? AND v.id != ?`
  ).all(member_id, project_id, exclude_id);
  res.json({ exists: rows.length > 0, count: rows.length, vouchers: rows });
};

exports.showCreate = async (req, res) => {
  await db.ready;
  const members = await db.prepare("SELECT id, membership_no, full_name FROM members WHERE status='Active' ORDER BY CAST(membership_no AS INTEGER)").all();
  const projects = await db.prepare("SELECT id, film_name, representative_id FROM projects WHERE status != 'Paid' ORDER BY film_name").all();
  const reps = await db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
  const preProject = req.query.project_id ? parseInt(req.query.project_id) : null;

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
      representative_id: preRepresentative
    },
    members, projects, reps, CHARACTERS, errors: []
  });
};

exports.create = async (req, res) => {
  await db.ready;
  const data = sanitize(req.body);
  const errors = validate(data);

  if (errors.length) {
    const members = await db.prepare("SELECT id, membership_no, full_name FROM members WHERE status='Active' ORDER BY CAST(membership_no AS INTEGER)").all();
    const projects = await db.prepare("SELECT id, film_name FROM projects ORDER BY film_name").all();
    const reps = await db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
    return res.render('vouchers/form', { title: 'New Voucher', voucher: data, members, projects, reps, CHARACTERS, errors });
  }

  if (!data.representative_id) {
    const proj = await db.prepare('SELECT representative_id FROM projects WHERE id = ?').get(data.project_id);
    if (proj?.representative_id) data.representative_id = proj.representative_id;
  }

  const result = await db.prepare(`INSERT INTO vouchers
    (voucher_type, member_id, project_id, character, representative_id, status, voucher_date,
     amount, gw_fund_percent, gw_fund_amount, representative_percent, representative_amount, final_amount)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    data.voucher_type, data.member_id, data.project_id, data.character,
    data.representative_id, data.status, data.voucher_date, data.amount,
    data.gw_fund_percent, data.gw_fund_amount, data.representative_percent,
    data.representative_amount, data.final_amount
  );

  req.flash('success', 'Voucher created successfully.');
  if (req.body._action === 'create_close') return res.redirect('/vouchers');
  res.redirect(`/vouchers/${result.lastInsertRowid}`);
};

exports.show = async (req, res) => {
  await db.ready;
  const voucher = await db.prepare(`SELECT v.*,
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

exports.showEdit = async (req, res) => {
  await db.ready;
  const voucher = await db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }
  const members = await db.prepare("SELECT id, membership_no, full_name FROM members ORDER BY CAST(membership_no AS INTEGER)").all();
  const projects = await db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();
  const reps = await db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
  res.render('vouchers/form', { title: 'Edit Voucher', voucher, members, projects, reps, CHARACTERS, errors: [], isEdit: true });
};

exports.update = async (req, res) => {
  await db.ready;
  const voucher = await db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }

  const data = sanitize(req.body);
  const errors = validate(data);

  if (errors.length) {
    const members = await db.prepare("SELECT id, membership_no, full_name FROM members ORDER BY CAST(membership_no AS INTEGER)").all();
    const projects = await db.prepare('SELECT id, film_name FROM projects ORDER BY film_name').all();
    const reps = await db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
    return res.render('vouchers/form', { title: 'Edit Voucher', voucher: { ...voucher, ...data }, members, projects, reps, CHARACTERS, errors, isEdit: true });
  }

  await db.prepare(`UPDATE vouchers SET voucher_type=?, member_id=?, project_id=?, character=?,
    representative_id=?, status=?, voucher_date=?, amount=?, gw_fund_percent=?, gw_fund_amount=?,
    representative_percent=?, representative_amount=?, final_amount=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`
  ).run(
    data.voucher_type, data.member_id, data.project_id, data.character,
    data.representative_id, data.status, data.voucher_date, data.amount, data.gw_fund_percent,
    data.gw_fund_amount, data.representative_percent, data.representative_amount,
    data.final_amount, voucher.id
  );

  req.flash('success', 'Voucher updated.');
  res.redirect(`/vouchers/${voucher.id}`);
};

exports.markPaid = async (req, res) => {
  await db.ready;
  const voucher = await db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }

  const { payment_method, payment_notes } = req.body;

  if (!payment_method) {
    req.flash('error', 'Payment method is required.');
    return res.redirect(`/vouchers/${voucher.id}`);
  }

  const ALLOWED_PAYMENT_METHODS = ['Cash', 'Cheque', 'NEFT', 'RTGS', 'Others'];
  if (!ALLOWED_PAYMENT_METHODS.includes(payment_method)) {
    req.flash('error', 'Invalid payment method.');
    return res.redirect(`/vouchers/${voucher.id}`);
  }

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

  await db.prepare(`UPDATE vouchers SET status='Paid', paid_on=CURRENT_TIMESTAMP,
    payment_method=?, payment_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(payment_method, payment_notes || null, voucher.id);

  const member = await db.prepare('SELECT full_name FROM members WHERE id = ?').get(voucher.member_id);
  const project = await db.prepare('SELECT film_name FROM projects WHERE id = ?').get(voucher.project_id);
  // Use IST date for transaction_date (date('now') is UTC and can be a day behind in +05:30)
  const istDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' }); // 'sv' locale gives YYYY-MM-DD
  await db.prepare(`INSERT INTO statements (transaction_date, income_type, paid_to, project_id, payment_mode, transaction_remarks, amount_type, amount)
    VALUES (?, 'Artist Payment', ?, ?, ?, ?, 'Debit', ?)`)
  .run(
    istDate,
    member?.full_name, voucher.project_id,
    payment_method || 'Others',
    `Voucher #${voucher.id} — ${project?.film_name}`,
    voucher.final_amount
  );

  req.flash('success', 'Voucher marked as paid.');
  const ref = req.get('Referer') || `/vouchers/${voucher.id}`;
  res.redirect(ref);
};

exports.destroy = async (req, res) => {
  await db.ready;
  const voucher = await db.prepare('SELECT * FROM vouchers WHERE id = ?').get(req.params.id);
  if (!voucher) { req.flash('error', 'Voucher not found.'); return res.redirect('/vouchers'); }
  if (voucher.status === 'Paid') {
    req.flash('error', 'Cannot delete a paid voucher.');
    return res.redirect(`/vouchers/${voucher.id}`);
  }
  await db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucher.id);
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
  // Validate voucher_date — must be YYYY-MM-DD; default to today
  const today = new Date().toISOString().slice(0, 10);
  const vDate = body.voucher_date && /^\d{4}-\d{2}-\d{2}$/.test(body.voucher_date)
    ? body.voucher_date : today;
  return {
    voucher_type: body.voucher_type || 'Artist',
    member_id: parseInt(body.member_id) || null,
    project_id: parseInt(body.project_id) || null,
    character: body.character || null,
    representative_id: body.representative_id ? parseInt(body.representative_id) : null,
    status: body.status || 'Pending',
    voucher_date: vDate,
    amount, gw_fund_percent: gwPct, gw_fund_amount: gwAmt,
    representative_percent: repPct, representative_amount: repAmt, final_amount: finalAmt
  };
}

function validate(data) {
  const errors = [];
  if (!data.member_id) errors.push('Member is required.');
  if (!data.project_id) errors.push('Project is required.');
  if (data.amount <= 0) errors.push('Amount must be greater than 0.');
  return errors;
}
