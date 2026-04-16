const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const members = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN status='Expired' THEN 1 ELSE 0 END) as expired,
    SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM members`).get();

  const vouchers = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid,
    SUM(final_amount) as total_disbursed,
    SUM(CASE WHEN status='Pending' THEN final_amount ELSE 0 END) as pending_amount
    FROM vouchers`).get();

  const projects = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid,
    SUM(amount) as total_amount,
    SUM(payment_received) as total_received
    FROM projects`).get();

  const financials = db.prepare(`SELECT
    SUM(CASE WHEN amount_type='Credit' THEN amount ELSE 0 END) as total_credit,
    SUM(CASE WHEN amount_type='Debit' THEN amount ELSE 0 END) as total_debit
    FROM statements`).get();

  const balance = (financials.total_credit || 0) - (financials.total_debit || 0);

  // Recent activity
  const recentVouchers = db.prepare(`SELECT v.id, v.status, v.final_amount, v.created_at,
    m.full_name, p.film_name FROM vouchers v
    JOIN members m ON v.member_id = m.id
    JOIN projects p ON v.project_id = p.id
    ORDER BY v.created_at DESC LIMIT 8`).all();

  const recentProjects = db.prepare(`SELECT p.id, p.film_name, p.production_company, p.amount, p.status, p.end_date
    FROM projects p ORDER BY p.created_at DESC LIMIT 5`).all();

  const pendingVouchers = db.prepare(`SELECT v.id, v.final_amount, m.full_name, m.bank_account_no, p.film_name
    FROM vouchers v JOIN members m ON v.member_id = m.id JOIN projects p ON v.project_id = p.id
    WHERE v.status = 'Pending' ORDER BY v.created_at LIMIT 10`).all();

  res.render('dashboard/index', {
    title: 'Dashboard — SICTADAU',
    members, vouchers, projects, financials, balance,
    recentVouchers, recentProjects, pendingVouchers
  });
});

module.exports = router;
