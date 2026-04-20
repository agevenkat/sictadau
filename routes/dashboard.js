const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    await db.ready;
    const medium = req.session.activeMedium || 'Film';

    // Single network round-trip to Turso for all 9 queries — filtered by active medium
    const results = await db.batch([
      // members: not medium-specific
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status='Expired' THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM members`,
      // vouchers: join through projects to filter by medium
      { sql: `SELECT COUNT(*) as total,
        SUM(CASE WHEN v.status='Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN v.status='Paid' THEN 1 ELSE 0 END) as paid,
        SUM(v.final_amount) as total_disbursed,
        SUM(CASE WHEN v.status='Pending' THEN v.final_amount ELSE 0 END) as pending_amount
        FROM vouchers v JOIN projects p ON v.project_id = p.id WHERE COALESCE(p.project_type, 'Film') = ?`, args: [medium] },
      // projects: filter by medium
      { sql: `SELECT COUNT(*) as total,
        SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid,
        SUM(amount) as total_amount,
        SUM(payment_received) as total_received
        FROM projects WHERE COALESCE(project_type, 'Film') = ?`, args: [medium] },
      // financials: statements linked to medium projects (+ standalone entries)
      { sql: `SELECT SUM(CASE WHEN s.amount_type='Credit' THEN s.amount ELSE 0 END) as total_credit,
        SUM(CASE WHEN s.amount_type='Debit' THEN s.amount ELSE 0 END) as total_debit
        FROM statements s LEFT JOIN projects p ON s.project_id = p.id
        WHERE (s.project_id IS NULL OR COALESCE(p.project_type, 'Film') = ?)`, args: [medium] },
      // recent vouchers
      { sql: `SELECT v.id, v.status, v.final_amount, v.created_at,
        m.full_name, p.film_name FROM vouchers v
        JOIN members m ON v.member_id = m.id
        JOIN projects p ON v.project_id = p.id
        WHERE COALESCE(p.project_type, 'Film') = ? ORDER BY v.created_at DESC LIMIT 8`, args: [medium] },
      // recent projects
      { sql: `SELECT p.id, p.film_name, p.production_company, p.amount, p.status, p.end_date
        FROM projects p WHERE COALESCE(p.project_type, 'Film') = ? ORDER BY p.created_at DESC LIMIT 5`, args: [medium] },
      // pending vouchers
      { sql: `SELECT v.id, v.final_amount, m.full_name, m.bank_account_no, p.film_name
        FROM vouchers v JOIN members m ON v.member_id = m.id
        JOIN projects p ON v.project_id = p.id
        WHERE v.status = 'Pending' AND COALESCE(p.project_type, 'Film') = ? ORDER BY v.created_at LIMIT 10`, args: [medium] },
      // monthly voucher disbursements
      { sql: `SELECT strftime('%Y-%m', COALESCE(v.voucher_date, date(v.created_at))) as month,
        SUM(CASE WHEN v.status='Paid' THEN v.final_amount ELSE 0 END) as paid_amount,
        COUNT(CASE WHEN v.status='Paid' THEN 1 END) as paid_count,
        SUM(CASE WHEN v.status='Pending' THEN v.final_amount ELSE 0 END) as pending_amount
        FROM vouchers v JOIN projects p ON v.project_id = p.id
        WHERE COALESCE(p.project_type, 'Film') = ? GROUP BY month ORDER BY month DESC LIMIT 12`, args: [medium] },
      // monthly statement flow
      { sql: `SELECT strftime('%Y-%m', s.transaction_date) as month,
        SUM(CASE WHEN s.amount_type='Credit' THEN s.amount ELSE 0 END) as credit,
        SUM(CASE WHEN s.amount_type='Debit' THEN s.amount ELSE 0 END) as debit
        FROM statements s LEFT JOIN projects p ON s.project_id = p.id
        WHERE (s.project_id IS NULL OR COALESCE(p.project_type, 'Film') = ?)
        GROUP BY month ORDER BY month DESC LIMIT 12`, args: [medium] }
    ]);

    const members      = results[0].first() || {};
    const vouchers     = results[1].first() || {};
    const projects     = results[2].first() || {};
    const financials   = results[3].first() || {};
    const balance      = (financials.total_credit || 0) - (financials.total_debit || 0);
    const recentVouchers   = results[4].rows;
    const recentProjects   = results[5].rows;
    const pendingVouchers  = results[6].rows;
    const monthlyVouchers  = results[7].rows.reverse();
    const monthlyStatements = results[8].rows.reverse();

    res.render('dashboard/index', {
      title: 'Dashboard — SICTADAU',
      members, vouchers, projects, financials, balance,
      recentVouchers, recentProjects, pendingVouchers,
      monthlyVouchers, monthlyStatements, medium
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).render('error', { title: 'Error', error: {}, activePage: '' });
  }
});

module.exports = router;
