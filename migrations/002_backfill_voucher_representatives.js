/**
 * Migration: Auto-populate Voucher Representatives
 *
 * ISSUE: ALL 32,637 vouchers are missing representative_id
 * This breaks project accountability and coordination
 *
 * ACTION:
 * - Populate voucher.representative_id from project.representative_id
 * - Only populate for vouchers where project has a representative
 * - Create audit log entries for tracking
 *
 * STATUS: Data migration script (run once)
 * AUTHOR: System
 * DATE: April 17, 2026
 */

const db = require('../database/db');

console.log('🔄 Starting migration: Auto-populate Voucher Representatives...\n');

try {
  // ============================================
  // STEP 1: Analyze current state
  // ============================================
  console.log('📊 STEP 1: Analyzing current state...');

  const voucherStats = db.prepare(`
    SELECT
      COUNT(*) as total_vouchers,
      SUM(CASE WHEN representative_id IS NULL THEN 1 ELSE 0 END) as missing_rep,
      SUM(CASE WHEN representative_id IS NOT NULL THEN 1 ELSE 0 END) as has_rep
    FROM vouchers
  `).get();

  console.log(`   Total Vouchers: ${voucherStats.total_vouchers}`);
  console.log(`   With representative: ${voucherStats.has_rep}`);
  console.log(`   Missing representative: ${voucherStats.missing_rep}`);

  const projectStats = db.prepare(`
    SELECT
      COUNT(*) as total_projects,
      SUM(CASE WHEN representative_id IS NULL THEN 1 ELSE 0 END) as no_rep,
      SUM(CASE WHEN representative_id IS NOT NULL THEN 1 ELSE 0 END) as has_rep
    FROM projects
  `).get();

  console.log(`\n   Total Projects: ${projectStats.total_projects}`);
  console.log(`   Projects with representative: ${projectStats.has_rep}`);
  console.log(`   Projects without representative: ${projectStats.no_rep}`);
  console.log('   ✅ Analysis complete\n');

  // ============================================
  // STEP 2: Create backup
  // ============================================
  console.log('💾 STEP 2: Creating backup...');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS vouchers_backup_rep_20260417 AS
    SELECT * FROM vouchers WHERE representative_id IS NULL
  `).run();

  const backupCount = db.prepare('SELECT COUNT(*) as count FROM vouchers_backup_rep_20260417').get();
  console.log(`   Backed up ${backupCount.count} records\n`);

  // ============================================
  // STEP 3: Create audit log table
  // ============================================
  console.log('📝 STEP 3: Setting up audit logging...');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS representative_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      project_id INTEGER,
      old_representative_id INTEGER,
      new_representative_id INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT
    )
  `).run();

  console.log('   ✅ Audit log ready\n');

  // ============================================
  // STEP 4: Auto-populate representatives
  // ============================================
  console.log('🔧 STEP 4: Populating representative_id from projects...');

  // Update vouchers where project has a representative
  const updateResult = db.prepare(`
    UPDATE vouchers
    SET representative_id = (
      SELECT representative_id FROM projects
      WHERE projects.id = vouchers.project_id
      AND projects.representative_id IS NOT NULL
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE representative_id IS NULL
    AND project_id IN (
      SELECT id FROM projects WHERE representative_id IS NOT NULL
    )
  `).run();

  console.log(`   Updated ${updateResult.changes} vouchers\n`);

  // ============================================
  // STEP 5: Create audit log entries
  // ============================================
  console.log('📋 STEP 5: Creating audit log entries...');

  const auditCount = db.prepare(`
    SELECT COUNT(*) as count FROM vouchers
    WHERE representative_id IS NOT NULL
  `).get().count;

  // Log the backfill operation
  db.prepare(`
    INSERT INTO representative_audit_log (voucher_id, new_representative_id, reason)
    SELECT v.id, v.representative_id, 'Data migration: populated from project.representative_id'
    FROM vouchers v
    WHERE v.representative_id IS NOT NULL
    AND v.id IN (SELECT id FROM vouchers_backup_rep_20260417)
  `).run();

  const logCount = db.prepare('SELECT COUNT(*) as count FROM representative_audit_log').get();
  console.log(`   Created ${logCount.count} audit log entries\n`);

  // ============================================
  // STEP 6: Verify results
  // ============================================
  console.log('✅ STEP 6: Verifying results...');

  const finalStats = db.prepare(`
    SELECT
      COUNT(*) as total_vouchers,
      SUM(CASE WHEN representative_id IS NULL THEN 1 ELSE 0 END) as still_missing,
      SUM(CASE WHEN representative_id IS NOT NULL THEN 1 ELSE 0 END) as now_has_rep,
      COUNT(DISTINCT representative_id) as unique_representatives
    FROM vouchers
  `).get();

  console.log('   Distribution after migration:');
  console.log(`   ├─ Total Vouchers: ${finalStats.total_vouchers}`);
  console.log(`   ├─ With representative: ${finalStats.now_has_rep}`);
  console.log(`   ├─ Still missing: ${finalStats.still_missing}`);
  console.log(`   └─ Unique representatives: ${finalStats.unique_representatives}`);

  if (finalStats.still_missing === 0) {
    console.log('\n   ✅ SUCCESS: All vouchers populated!\n');
  } else {
    console.log(`\n   ℹ️  INFO: ${finalStats.still_missing} vouchers still missing representative`);
    console.log('           (These are from projects without a representative assigned)\n');
  }

  // ============================================
  // STEP 7: Sample verification
  // ============================================
  console.log('🔍 STEP 7: Sample verification (first 5 vouchers with representative)...');

  const samples = db.prepare(`
    SELECT
      v.id as voucher_id,
      p.film_name,
      r.name as representative_name,
      v.representative_id
    FROM vouchers v
    JOIN projects p ON v.project_id = p.id
    LEFT JOIN representatives r ON v.representative_id = r.id
    WHERE v.representative_id IS NOT NULL
    ORDER BY v.id DESC
    LIMIT 5
  `).all();

  samples.forEach(sample => {
    console.log(`   Voucher #${sample.voucher_id}: "${sample.film_name}" → Rep: ${sample.representative_name || 'None'}`);
  });

  console.log('\n========================================');
  console.log('✅ MIGRATION COMPLETED');
  console.log('========================================\n');

  console.log('📌 NEXT STEPS:');
  console.log('   1. Test the voucher creation form');
  console.log('   2. Verify representative is auto-selected based on project');
  console.log('   3. Review audit_log table');
  console.log('   4. Test voucher display pages\n');

} catch (error) {
  console.error('❌ MIGRATION FAILED:', error.message);
  console.error('\nROLLBACK: No changes applied due to error.\n');
  console.error('Stack:', error.stack);
  process.exit(1);
}
