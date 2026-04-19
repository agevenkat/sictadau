const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    await db.ready;

    // Single network round-trip to Turso for all 9 queries
    const results = await db.batch([
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status='Expired' THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM members`,
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid,
        SUM(final_amount) as total_disbursed,
        SUM(CASE WHEN status='Pending' THEN final_amount ELSE 0 END) as pending_amount
        FROM vouchers`,
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid,
        SUM(amount) as total_amount,
        SUM(payment_received) as total_received
        FROM projects`,
      `SELECT SUM(CASE WHEN amount_type='Credit' THEN amount ELSE 0 END) as total_credit,
        SUM(CASE WHEN amount_type='Debit' THEN amount ELSE 0 END) as total_debit
        FROM statements`,
      `SELECT v.id, v.status, v.final_amount, v.created_at,
        m.full_name, p.film_name FROM vouchers v
        JOIN members m ON v.member_id = m.id
        JOIN projects p ON v.project_id = p.id
        ORDER BY v.created_at DESC LIMIT 8`,
      `SELECT p.id, p.film_name, p.production_company, p.amount, p.status, p.end_date
        FROM projects p ORDER BY p.created_at DESC LIMIT 5`,
      `SELECT v.id, v.final_amount, m.full_name, m.bank_account_no, p.film_name
        FROM vouchers v JOIN members m ON v.member_id = m.id
        JOIN projects p ON v.project_id = p.id
        WHERE v.status = 'Pending' ORDER BY v.created_at LIMIT 10`,
      `SELECT strftime('%Y-%m', COALESCE(v.voucher_date, date(v.created_at))) as month,
        SUM(CASE WHEN v.status='Paid' THEN v.final_amount ELSE 0 END) as paid_amount,
        COUNT(CASE WHEN v.status='Paid' THEN 1 END) as paid_count,
        SUM(CASE WHEN v.status='Pending' THEN v.final_amount ELSE 0 END) as pending_amount
        FROM vouchers v GROUP BY month ORDER BY month DESC LIMIT 12`,
      `SELECT strftime('%Y-%m', transaction_date) as month,
        SUM(CASE WHEN amount_type='Credit' THEN amount ELSE 0 END) as credit,
        SUM(CASE WHEN amount_type='Debit' THEN amount ELSE 0 END) as debit
        FROM statements GROUP BY month ORDER BY month DESC LIMIT 12`
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
      monthlyVouchers, monthlyStatements
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).render('error', { title: 'Error', error: {}, activePage: '' });
  }
});

module.exports = router;
