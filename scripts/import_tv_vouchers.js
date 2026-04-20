#!/usr/bin/env node
// Import TV Vouchers from tvvouchers.csv
// Run: node --experimental-sqlite scripts/import_tv_vouchers.js

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/sictadau.db');
const CSV_PATH = path.join(process.env.HOME, 'Desktop/tvvouchers.csv');

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

// ── Parse CSV ──────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  cols.push(cur.trim());
  return cols;
}

const lines = fs.readFileSync(CSV_PATH, 'utf8').split('\n').filter(Boolean);
const HEADER = parseCsvLine(lines[0]);
// id,recepient_name,member_no,movie_name,representative_name,character,
// amount,status,created_at,updated_at,deleted_at,union_amount,
// representative_amount,final_amount,project_id,rep_percent,voucher_type,episode_no

const COL = {};
HEADER.forEach((h, i) => COL[h] = i);

const rows = lines.slice(1).map(l => parseCsvLine(l));

// ── Build lookup: CSV project_id → film_name ───────────────────────────────
const csvProjFilm = {};
rows.forEach(r => {
  const csvPid = r[COL.project_id];
  const filmName = r[COL.movie_name];
  if (csvPid && filmName && !csvProjFilm[csvPid]) {
    csvProjFilm[csvPid] = filmName;
  }
});

// ── Load DB TV projects: film_name → db id ─────────────────────────────────
const tvProjects = db.prepare(
  "SELECT id, film_name FROM projects WHERE project_type='Television'"
).all();
const dbProjByFilm = {};
tvProjects.forEach(p => { dbProjByFilm[p.film_name] = p.id; });

// Map CSV project_id → DB project id
const csvPidToDbId = {};
let unmappedProjects = [];
Object.entries(csvProjFilm).forEach(([csvPid, filmName]) => {
  const dbId = dbProjByFilm[filmName];
  if (dbId) {
    csvPidToDbId[csvPid] = dbId;
  } else {
    unmappedProjects.push({ csvPid, filmName });
  }
});

// Manual overrides for film name mismatches / typos
const manualOverrides = {
  'Chinnanjiru Kiliye':                        1722, // no episode range → (30epi-51epi)
  'Chinnankiru Kiliye (117epi - 140epi)':      1846, // typo "ankiru" → "anjiru"
};
Object.entries(manualOverrides).forEach(([filmName, dbId]) => {
  // Find csv pid for this film name
  const entry = Object.entries(csvProjFilm).find(([, fn]) => fn === filmName);
  if (entry) csvPidToDbId[entry[0]] = dbId;
});

if (unmappedProjects.length > 0) {
  // Re-check after overrides
  const stillUnmapped = unmappedProjects.filter(u => !csvPidToDbId[u.csvPid]);
  if (stillUnmapped.length > 0) {
    console.warn('⚠ Unmapped projects (film_name not found in DB):');
    stillUnmapped.forEach(u => console.warn('  CSV pid', u.csvPid, '→', u.filmName));
  }
}

// ── Load representatives: normalised name → id ─────────────────────────────
const reps = db.prepare("SELECT id, name FROM representatives").all();
function normName(n) { return (n || '').toLowerCase().replace(/[^a-z0-9]/g,''); }
const repByNorm = {};
reps.forEach(r => { repByNorm[normName(r.name)] = r.id; });

// Also try partial match: if CSV rep name contains rep's name or vice versa
function findRepId(csvRepName) {
  if (!csvRepName) return null;
  const ncsv = normName(csvRepName);
  if (repByNorm[ncsv]) return repByNorm[ncsv];
  // Try substring match
  for (const [norm, id] of Object.entries(repByNorm)) {
    if (ncsv.includes(norm) || norm.includes(ncsv)) return id;
  }
  return null;
}

// ── Load members: membership_no → id ──────────────────────────────────────
const members = db.prepare("SELECT id, membership_no FROM members").all();
const memberByNo = {};
members.forEach(m => { memberByNo[m.membership_no] = m.id; });

// ── Insert vouchers ────────────────────────────────────────────────────────
const insertVoucher = db.prepare(`
  INSERT INTO vouchers (
    voucher_type, member_id, project_id, character,
    representative_id, status,
    amount, gw_fund_percent, gw_fund_amount,
    representative_percent, representative_amount,
    final_amount, voucher_date, paid_on,
    payment_method, episode_no,
    created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?
  )
`);

let inserted = 0, skippedDeleted = 0, skippedNoMember = 0, skippedNoProject = 0, skippedNoRep = 0;
const warnings = [];

for (const r of rows) {
  // Skip deleted
  const deletedAt = r[COL.deleted_at];
  if (deletedAt && deletedAt !== 'null' && deletedAt !== '') {
    skippedDeleted++;
    continue;
  }

  const csvPid   = r[COL.project_id];
  const memberNo = r[COL.member_no];
  const csvStat  = r[COL.status];
  const amount   = parseFloat(r[COL.amount]) || 0;
  const unionAmt = parseFloat(r[COL.union_amount]) || 0;
  const repAmt   = parseFloat(r[COL.representative_amount]) || 0;
  let   finalAmt = parseFloat(r[COL.final_amount]) || 0;
  const repPct   = parseFloat(r[COL.rep_percent]) || 0;
  const createdAt = r[COL.created_at] || null;
  const updatedAt = r[COL.updated_at] || null;
  const episodeNo = r[COL.episode_no] || null;
  const character = r[COL.character] || null;
  const voucherType = r[COL.voucher_type] || 'Artist';
  const csvRepName = r[COL.representative_name] || '';

  // Map project
  const dbProjectId = csvPidToDbId[csvPid];
  if (!dbProjectId) {
    skippedNoProject++;
    continue;
  }

  // Map member
  const memberId = memberByNo[memberNo];
  if (!memberId) {
    skippedNoMember++;
    warnings.push(`Member not found: no=${memberNo}, name=${r[COL.recepient_name]}`);
    continue;
  }

  // Map rep (nullable)
  const repId = findRepId(csvRepName);
  if (csvRepName && !repId) {
    skippedNoRep++;
    warnings.push(`Rep not found: "${csvRepName}" (member ${memberNo})`);
    continue;
  }

  // Status: 1=Pending, 2=Paid
  const status = csvStat === '2' ? 'Paid' : 'Pending';
  const paidOn = status === 'Paid' ? (updatedAt || null) : null;

  // GW fund percent
  const gwPct = amount > 0 ? Math.round((unionAmt / amount) * 100 * 100) / 100 : 5;

  // Compute final if 0
  if (finalAmt === 0 && amount > 0) {
    finalAmt = amount - unionAmt - repAmt;
  }

  // Voucher date from created_at
  const voucherDate = createdAt ? createdAt.split(' ')[0] : null;

  insertVoucher.run(
    voucherType, memberId, dbProjectId, character,
    repId, status,
    amount, gwPct, unionAmt,
    repPct, repAmt,
    finalAmt, voucherDate, paidOn,
    'NEFT', episodeNo,
    createdAt, updatedAt
  );
  inserted++;
}

// Checkpoint WAL
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");

console.log('\n═══════════════════════════════════════');
console.log('TV Vouchers Import Complete');
console.log('═══════════════════════════════════════');
console.log(`✓ Inserted:             ${inserted}`);
console.log(`✗ Skipped (deleted):    ${skippedDeleted}`);
console.log(`✗ Skipped (no member):  ${skippedNoMember}`);
console.log(`✗ Skipped (no project): ${skippedNoProject}`);
console.log(`✗ Skipped (no rep):     ${skippedNoRep}`);

const total = db.prepare("SELECT COUNT(*) AS c FROM vouchers").get();
console.log(`\nTotal vouchers in DB:   ${total.c}`);

if (warnings.length > 0) {
  console.log('\nWarnings (first 20):');
  warnings.slice(0, 20).forEach(w => console.log(' ·', w));
}
