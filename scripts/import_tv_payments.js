#!/usr/bin/env node
// Import TV payments from tvpayments.csv → Turso
// Updates: statements (Credit+Debit), project_payments, voucher paid_on/status
// Run: node scripts/import_tv_payments.js

const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

const TURSO_URL   = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
if (!TURSO_URL || !TURSO_TOKEN) { console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN'); process.exit(1); }

const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

const PAYMENTS_CSV = path.join(process.env.HOME, 'Desktop/tvpayments.csv');
const VOUCHERS_CSV = path.join(process.env.HOME, 'Desktop/tvvouchers.csv');

// ── CSV parser ─────────────────────────────────────────────────────────────
function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  function parseLine(line) {
    const cols = []; let cur = '', inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim()); return cols;
  }
  const hdr = parseLine(lines[0]);
  const COL = {}; hdr.forEach((h, i) => COL[h] = i);
  const rows = lines.slice(1).map(l => parseLine(l));
  return { rows, COL };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function cleanDate(d) {
  if (!d || d === 'null' || d === '') return null;
  // "2025-11-12, 16:11:00" → "2025-11-12 16:11:00" → take date portion
  const s = d.replace(',', '').replace(/\s+/, ' ').trim();
  return s.split(' ')[0]; // just the YYYY-MM-DD part
}

function cleanDatetime(d) {
  if (!d || d === 'null' || d === '') return null;
  return d.replace(',', '').replace(/\s+/, ' ').trim();
}

function mapPaymentMode(mode) {
  if (!mode || mode === 'null') return 'Others';
  const m = mode.toLowerCase();
  if (m === 'cash') return 'Cash';
  if (m === 'cheque') return 'Cheque';
  if (m === 'bank transfer' || m === 'neft' || m === 'rtgs') return 'NEFT';
  return 'Others'; // UPI, Others, undefined
}

function mapIncomeType(t) {
  if (!t || t === 'null') return 'Working Report Payment';
  const l = t.toLowerCase();
  if (l.includes('income') || l.includes('movie') || l.includes('serial')) return 'Working Report Payment';
  if (l.includes('donat') || l.includes('sonation')) return 'Other';
  return 'Working Report Payment';
}

async function run() {
  // ── Build: old voucher_id → created_at (from tvvouchers.csv) ─────────────
  console.log('\n── Building old voucher ID map from tvvouchers.csv ──────────');
  const { rows: vRows, COL: vCOL } = parseCsv(VOUCHERS_CSV);
  // old_id → created_at  (the timestamp we inserted into Turso)
  const oldIdToCreatedAt = {};
  vRows.forEach(r => {
    const oid = r[vCOL.id];
    const cat = r[vCOL.created_at];
    if (oid && cat && cat !== 'null') oldIdToCreatedAt[oid] = cat;
  });
  console.log(`  Mapped ${Object.keys(oldIdToCreatedAt).length} old voucher IDs`);

  // ── Fetch Turso vouchers: created_at → {id, project_id} ──────────────────
  console.log('\n── Fetching TV vouchers from Turso ──────────────────────────');
  const tvVouchers = await turso.execute(`
    SELECT v.id, v.created_at, v.project_id, v.member_id, v.amount
    FROM vouchers v
    JOIN projects p ON v.project_id = p.id
    WHERE p.project_type = 'Television'
  `);
  // created_at → turso voucher id  (use exact string match)
  const createdAtToTursoId = {};
  tvVouchers.rows.forEach(r => {
    createdAtToTursoId[String(r.created_at)] = Number(r.id);
  });
  console.log(`  TV vouchers in Turso: ${tvVouchers.rows.length}`);

  // Build: old_voucher_id → turso_voucher_id
  const oldIdToTursoId = {};
  let mappedVouchers = 0;
  for (const [oldId, cat] of Object.entries(oldIdToCreatedAt)) {
    const tursoId = createdAtToTursoId[cat];
    if (tursoId) { oldIdToTursoId[oldId] = tursoId; mappedVouchers++; }
  }
  console.log(`  Matched: ${mappedVouchers} / ${Object.keys(oldIdToCreatedAt).length} vouchers`);

  // ── Fetch Turso TV projects: film_name → id ───────────────────────────────
  const tvProjects = await turso.execute(
    `SELECT id, film_name FROM projects WHERE project_type = 'Television'`
  );
  const filmToId = {};
  tvProjects.rows.forEach(r => { filmToId[r.film_name] = Number(r.id); });

  // ── Parse payments CSV ────────────────────────────────────────────────────
  const { rows, COL } = parseCsv(PAYMENTS_CSV);
  const active = rows.filter(r => !r[COL.deleted_at] || r[COL.deleted_at] === 'null' || r[COL.deleted_at] === '');
  console.log(`\n── Processing ${active.length} active payment rows (${rows.length - active.length} deleted skipped)`);

  // ── Separate Credit and Debit ─────────────────────────────────────────────
  const credits = active.filter(r => r[COL.transaction_type] === 'Credit');
  const debits  = active.filter(r => r[COL.transaction_type] === 'Debit');
  console.log(`  Credits: ${credits.length}  |  Debits: ${debits.length}`);

  // ── Check existing statements to avoid duplicates ─────────────────────────
  const existingStmts = await turso.execute(`
    SELECT COUNT(*) as c FROM statements s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE p.project_type = 'Television' OR s.project_id IS NULL
  `);
  // We'll use a lighter dedup: check if TV statements already exist
  const tvStmtCount = await turso.execute(`
    SELECT COUNT(*) as c FROM statements s
    JOIN projects p ON s.project_id = p.id
    WHERE p.project_type = 'Television'
  `);
  console.log(`  Existing TV statements in Turso: ${tvStmtCount.rows[0].c}`);

  if (Number(tvStmtCount.rows[0].c) > 0) {
    console.log('  ⚠ TV statements already exist — skipping statement inserts to avoid duplication.');
    console.log('    (If you want to re-import, delete TV statements from Turso first.)');
    return;
  }

  // ── 1. Insert Credit statements + project_payments ────────────────────────
  console.log('\n── Inserting Credit entries ─────────────────────────────────');
  let creditInserted = 0, creditNoProject = 0;

  const creditStmts = [];
  const projPaymentStmts = [];

  for (const r of credits) {
    const txDate    = cleanDate(r[COL.transaction_date]);
    const amount    = parseFloat(r[COL.amount]) || 0;
    const filmName  = (r[COL.movie_name] || '').trim();
    const payMode   = mapPaymentMode(r[COL.payment_mode]);
    const incType   = mapIncomeType(r[COL.income_type]);
    const remark    = r[COL.remark] || null;
    const projectId = filmToId[filmName] || null;

    if (!projectId) { creditNoProject++; }

    creditStmts.push({
      sql: `INSERT INTO statements (transaction_date, income_type, paid_to, project_id, payment_mode, transaction_remarks, amount_type, amount, receipt, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'Credit', ?, NULL, ?)`,
      args: [txDate, incType, null, projectId, payMode, remark, amount, r[COL.created_at] || txDate]
    });

    // Also record in project_payments if linked to a project
    if (projectId) {
      projPaymentStmts.push({
        sql: `INSERT INTO project_payments (project_id, transaction_date, payment_type, notes, amount, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [projectId, txDate, payMode, remark, amount, r[COL.created_at] || txDate]
      });
    }
  }

  // Batch insert credits
  const BATCH = 50;
  for (let i = 0; i < creditStmts.length; i += BATCH) {
    await turso.batch(creditStmts.slice(i, i + BATCH), 'write');
    creditInserted += Math.min(BATCH, creditStmts.length - i);
    process.stdout.write(`\r  Statements: ${creditInserted} / ${credits.length}`);
  }
  console.log(`\n  No-project credits (still inserted): ${creditNoProject}`);

  // Insert project payments
  let ppInserted = 0;
  for (let i = 0; i < projPaymentStmts.length; i += BATCH) {
    await turso.batch(projPaymentStmts.slice(i, i + BATCH), 'write');
    ppInserted += Math.min(BATCH, projPaymentStmts.length - i);
  }
  console.log(`  Project payment records inserted: ${ppInserted}`);

  // Update projects.payment_received aggregate
  console.log('  Updating projects.payment_received...');
  await turso.execute(`
    UPDATE projects SET payment_received = (
      SELECT COALESCE(SUM(amount), 0) FROM project_payments WHERE project_id = projects.id
    ) WHERE project_type = 'Television'
  `);
  // Also set status to Completed/Paid where applicable
  await turso.execute(`
    UPDATE projects SET status = 'Paid'
    WHERE project_type = 'Television' AND payment_received >= amount AND amount > 0
  `);
  await turso.execute(`
    UPDATE projects SET status = 'Completed'
    WHERE project_type = 'Television' AND payment_received > 0 AND payment_received < amount AND status != 'Paid'
  `);
  console.log('  Project statuses updated.');

  // ── 2. Insert Debit statements + update vouchers ──────────────────────────
  console.log('\n── Inserting Debit entries ──────────────────────────────────');
  let debitInserted = 0, voucherUpdated = 0, voucherNotFound = 0;

  const debitStmtBatch = [];
  const voucherUpdates = [];

  for (const r of debits) {
    const txDate    = cleanDate(r[COL.transaction_date]);
    const paidOn    = cleanDatetime(r[COL.transaction_date]);
    const amount    = parseFloat(r[COL.amount]) || 0;
    const filmName  = (r[COL.movie_name] || '').trim();
    const payMode   = mapPaymentMode(r[COL.payment_mode]);
    const paidTo    = r[COL.payment_to] || null;
    const remark    = r[COL.remark] || null;
    const projectId = filmToId[filmName] || null;
    const oldVid    = r[COL.voucher_id] || null;
    const createdAt = r[COL.created_at] || txDate;

    debitStmtBatch.push({
      sql: `INSERT INTO statements (transaction_date, income_type, paid_to, project_id, payment_mode, transaction_remarks, amount_type, amount, receipt, created_at)
            VALUES (?, 'Artist Payment', ?, ?, ?, ?, 'Debit', ?, NULL, ?)`,
      args: [txDate, paidTo, projectId, payMode, remark, amount, createdAt]
    });

    // Update voucher if we can map the old ID
    if (oldVid && oldVid !== 'null' && oldIdToTursoId[oldVid]) {
      const tursoVid = oldIdToTursoId[oldVid];
      voucherUpdates.push({
        sql: `UPDATE vouchers SET status='Paid', paid_on=?, payment_method=?, updated_at=? WHERE id=?`,
        args: [paidOn, payMode === 'Others' ? 'NEFT' : payMode, createdAt, tursoVid]
      });
      voucherUpdated++;
    } else if (oldVid && oldVid !== 'null') {
      voucherNotFound++;
    }
  }

  // Batch insert debit statements
  for (let i = 0; i < debitStmtBatch.length; i += BATCH) {
    await turso.batch(debitStmtBatch.slice(i, i + BATCH), 'write');
    debitInserted += Math.min(BATCH, debitStmtBatch.length - i);
    process.stdout.write(`\r  Statements: ${debitInserted} / ${debits.length}`);
  }
  console.log();

  // Batch update vouchers
  console.log(`  Updating ${voucherUpdated} vouchers paid_on/status...`);
  for (let i = 0; i < voucherUpdates.length; i += BATCH) {
    await turso.batch(voucherUpdates.slice(i, i + BATCH), 'write');
    process.stdout.write(`\r  Vouchers: ${Math.min(i + BATCH, voucherUpdates.length)} / ${voucherUpdates.length}`);
  }
  console.log(`\n  Vouchers not matched (old ID missing): ${voucherNotFound}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const finalStmts = await turso.execute(`
    SELECT COUNT(*) as c FROM statements s
    JOIN projects p ON s.project_id = p.id
    WHERE p.project_type = 'Television'
  `);
  const finalPaid = await turso.execute(`
    SELECT COUNT(*) as c FROM vouchers v
    JOIN projects p ON v.project_id = p.id
    WHERE p.project_type = 'Television' AND v.status = 'Paid'
  `);
  const finalProjPay = await turso.execute(`
    SELECT COUNT(*) as c FROM project_payments pp
    JOIN projects p ON pp.project_id = p.id
    WHERE p.project_type = 'Television'
  `);

  console.log('\n══════════════════════════════════════════════════');
  console.log('TV Payments Import Complete');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Credit statements inserted:    ${creditInserted}`);
  console.log(`  Debit statements inserted:     ${debitInserted}`);
  console.log(`  Project payment records:       ${ppInserted}`);
  console.log(`  Vouchers marked Paid:          ${voucherUpdated}`);
  console.log(`  Voucher IDs not matched:       ${voucherNotFound}`);
  console.log('──────────────────────────────────────────────────');
  console.log(`  Turso TV statements total:     ${finalStmts.rows[0].c}`);
  console.log(`  Turso TV vouchers Paid:        ${finalPaid.rows[0].c}`);
  console.log(`  Turso TV project payments:     ${finalProjPay.rows[0].c}`);
  console.log('══════════════════════════════════════════════════\n');
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
