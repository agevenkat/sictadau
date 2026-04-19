const db = require('../database/db');

// ── Income overview ─────────────────────────────────────────────────────────
exports.index = async (req, res) => {
  await db.ready;

  const [kpiRow, rows] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(DISTINCT v.representative_id)          AS total_reps,
        COALESCE(SUM(v.representative_amount), 0)    AS total_earned,
        COALESCE((SELECT SUM(amount) FROM rep_payments WHERE status='Paid'),    0) AS total_paid,
        COALESCE((SELECT SUM(amount) FROM rep_payments WHERE status='Pending'), 0) AS total_pending
      FROM vouchers v
      JOIN projects p ON v.project_id = p.id
      WHERE p.project_type = 'Film' AND v.representative_id IS NOT NULL
    `).get(),

    db.prepare(`
      SELECT
        r.id   AS rep_id,   r.name AS rep_name, r.contact, r.email,
        p.id   AS project_id, p.film_name, p.production_company, p.status AS project_status,
        COUNT(v.id)                             AS voucher_count,
        COALESCE(SUM(v.amount), 0)              AS total_gross,
        COALESCE(SUM(v.representative_amount), 0) AS commission_amount,
        rp.id                                   AS rep_payment_id,
        rp.status                               AS payment_status,
        rp.amount                               AS payment_amount,
        rp.paid_on
      FROM representatives r
      JOIN vouchers v         ON v.representative_id = r.id
      JOIN projects p         ON v.project_id = p.id
      LEFT JOIN rep_payments rp ON rp.representative_id = r.id AND rp.project_id = p.id
      WHERE p.project_type = 'Film' AND v.representative_id IS NOT NULL
      GROUP BY r.id, p.id
      ORDER BY r.name, p.film_name
    `).all()
  ]);

  res.render('rep-payments/income', { title: 'Representative Income', rows, kpi: kpiRow || {} });
};

// ── Create voucher ───────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  await db.ready;
  const rep_id    = parseInt(req.body.rep_id);
  const project_id = parseInt(req.body.project_id);

  if (!rep_id || !project_id) {
    req.flash('error', 'Invalid request.');
    return res.redirect('/rep-payments');
  }

  const existing = await db.prepare(
    'SELECT id FROM rep_payments WHERE representative_id = ? AND project_id = ?'
  ).get(rep_id, project_id);

  if (existing) {
    return res.redirect(`/rep-payments/${existing.id}/slip`);
  }

  const row = await db.prepare(
    'SELECT COALESCE(SUM(representative_amount), 0) AS total FROM vouchers WHERE representative_id = ? AND project_id = ?'
  ).get(rep_id, project_id);

  const amount = row?.total || 0;
  const result = await db.prepare(
    'INSERT INTO rep_payments (representative_id, project_id, amount) VALUES (?,?,?)'
  ).run(rep_id, project_id, amount);

  req.flash('success', 'Representative commission voucher created.');
  res.redirect(`/rep-payments/${result.lastInsertRowid}/slip`);
};

// ── Printable slip ───────────────────────────────────────────────────────────
exports.slip = async (req, res) => {
  await db.ready;
  const payment = await db.prepare(`
    SELECT rp.*, r.name AS rep_name, r.contact, r.email,
           p.film_name, p.production_company, p.language, p.place_of_dubbing
    FROM rep_payments rp
    JOIN representatives r ON rp.representative_id = r.id
    JOIN projects p         ON rp.project_id = p.id
    WHERE rp.id = ?
  `).get(req.params.id);

  if (!payment) { req.flash('error', 'Voucher not found.'); return res.redirect('/rep-payments'); }

  const vouchers = await db.prepare(`
    SELECT v.id, m.full_name, m.membership_no, v.character,
           v.amount, v.representative_percent, v.representative_amount, v.status
    FROM vouchers v
    JOIN members m ON v.member_id = m.id
    WHERE v.representative_id = ? AND v.project_id = ?
    ORDER BY v.id
  `).all(payment.representative_id, payment.project_id);

  res.render('rep-payments/slip', {
    title: `Rep Voucher #${payment.id}`,
    payment, vouchers, layout: false
  });
};

// ── Mark paid ────────────────────────────────────────────────────────────────
exports.markPaid = async (req, res) => {
  await db.ready;
  const payment = await db.prepare(`
    SELECT rp.*, r.name AS rep_name, p.film_name
    FROM rep_payments rp
    JOIN representatives r ON rp.representative_id = r.id
    JOIN projects p         ON rp.project_id = p.id
    WHERE rp.id = ?
  `).get(req.params.id);

  if (!payment) { req.flash('error', 'Voucher not found.'); return res.redirect('/rep-payments'); }
  if (payment.status === 'Paid') {
    req.flash('info', 'Already marked as paid.');
    return res.redirect(`/rep-payments/${payment.id}/slip`);
  }

  const { payment_method, notes } = req.body;
  if (!payment_method) {
    req.flash('error', 'Payment method is required.');
    return res.redirect(`/rep-payments/${payment.id}/slip`);
  }

  await db.prepare(`
    UPDATE rep_payments
    SET status='Paid', paid_on=CURRENT_TIMESTAMP, payment_method=?, notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(payment_method, notes || null, payment.id);

  // Post Debit to Statement ledger
  const istDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' });
  await db.prepare(`
    INSERT INTO statements
      (transaction_date, income_type, paid_to, project_id, payment_mode, transaction_remarks, amount_type, amount)
    VALUES (?, 'Representative Commission', ?, ?, ?, ?, 'Debit', ?)
  `).run(
    istDate, payment.rep_name, payment.project_id,
    payment_method,
    `Rep Commission — ${payment.film_name} | ${payment.rep_name}`,
    payment.amount
  );

  req.flash('success', 'Payment recorded and posted to Statement ledger.');
  res.redirect(`/rep-payments/${payment.id}/slip`);
};

// ── Delete (pending only, admin) ─────────────────────────────────────────────
exports.destroy = async (req, res) => {
  await db.ready;
  const payment = await db.prepare('SELECT * FROM rep_payments WHERE id = ?').get(req.params.id);
  if (!payment) { req.flash('error', 'Not found.'); return res.redirect('/rep-payments'); }
  if (payment.status === 'Paid') {
    req.flash('error', 'Cannot delete a paid voucher.');
    return res.redirect('/rep-payments');
  }
  await db.prepare('DELETE FROM rep_payments WHERE id = ?').run(payment.id);
  req.flash('success', 'Voucher deleted.');
  res.redirect('/rep-payments');
};
