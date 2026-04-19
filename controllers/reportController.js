const db = require('../database/db');

exports.index = async (req, res) => {
  await db.ready;
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // Available years for the year selector
    const years = await db.prepare(`
      SELECT DISTINCT strftime('%Y', COALESCE(v.voucher_date, date(v.created_at))) as y
      FROM vouchers v WHERE y IS NOT NULL
      UNION
      SELECT DISTINCT strftime('%Y', transaction_date) as y
      FROM statements WHERE y IS NOT NULL
      ORDER BY y DESC LIMIT 10`).all();

    // ── 1. Monthly income vs expense for the year ──────────────────
    const monthlyFinancials = await db.prepare(`
      SELECT strftime('%m', transaction_date) as month,
             SUM(CASE WHEN amount_type='Credit' THEN amount ELSE 0 END) as credit,
             SUM(CASE WHEN amount_type='Debit'  THEN amount ELSE 0 END) as debit
      FROM statements
      WHERE strftime('%Y', transaction_date) = ?
      GROUP BY month ORDER BY month`).all(String(year));

    // ── 2. Income breakdown by type ──────────────────────────────
    const incomeByType = await db.prepare(`
      SELECT income_type, amount_type,
             COUNT(*) as count,
             SUM(amount) as total
      FROM statements
      WHERE strftime('%Y', transaction_date) = ?
        AND income_type IS NOT NULL
      GROUP BY income_type, amount_type
      ORDER BY total DESC`).all(String(year));

    // ── 3. Voucher disbursements by project (top 15) ─────────────
    const vouchersByProject = await db.prepare(`
      SELECT p.film_name,
             COUNT(v.id) as count,
             SUM(v.final_amount) as total_amount,
             SUM(CASE WHEN v.status='Paid' THEN v.final_amount ELSE 0 END) as paid_amount,
             SUM(CASE WHEN v.status='Pending' THEN v.final_amount ELSE 0 END) as pending_amount
      FROM vouchers v
      JOIN projects p ON v.project_id = p.id
      WHERE strftime('%Y', COALESCE(v.voucher_date, date(v.created_at))) = ?
      GROUP BY v.project_id ORDER BY total_amount DESC LIMIT 15`).all(String(year));

    // ── 4. Year totals ────────────────────────────────────────────
    const yearTotals = await db.prepare(`
      SELECT
        SUM(CASE WHEN amount_type='Credit' THEN amount ELSE 0 END) as total_credit,
        SUM(CASE WHEN amount_type='Debit'  THEN amount ELSE 0 END) as total_debit
      FROM statements
      WHERE strftime('%Y', transaction_date) = ?`).get(String(year));

    const yearVoucherTotals = await db.prepare(`
      SELECT COUNT(*) as total,
             SUM(final_amount) as total_amount,
             SUM(CASE WHEN status='Paid' THEN final_amount ELSE 0 END) as paid_amount,
             SUM(CASE WHEN status='Pending' THEN final_amount ELSE 0 END) as pending_amount,
             COUNT(CASE WHEN status='Paid' THEN 1 END) as paid_count,
             COUNT(CASE WHEN status='Pending' THEN 1 END) as pending_count
      FROM vouchers
      WHERE strftime('%Y', COALESCE(voucher_date, date(created_at))) = ?`).get(String(year));

    res.render('reports/index', {
      title: 'Financial Reports',
      year, years,
      monthlyFinancials, incomeByType, vouchersByProject,
      yearTotals, yearVoucherTotals
    });
  } catch (err) {
    console.error('Reports error:', err.message);
    res.status(500).render('error', { title: 'Error', error: {}, activePage: '' });
  }
};
