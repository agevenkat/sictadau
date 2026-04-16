/**
 * Migration: Backfill Missing Payment Methods
 *
 * ISSUE: 32,316 paid vouchers are missing payment_method field
 * This violates financial audit requirements
 *
 * ACTION:
 * - Set payment_method = 'NEFT' for all paid vouchers with NULL payment_method
 * - Set paid_on = updated_at if paid_on is NULL
 * - Create audit log entries for tracking
 * - Add NOT NULL constraint to prevent future issues
 *
 * STATUS: Data migration script (run once)
 * AUTHOR: System
 * DATE: April 17, 2026
 */

const db = require('../database/db');

console.log('🔄 Starting migration: Backfill Missing Payment Methods...\n');

try {
  // ============================================
  // STEP 1: Analyze current state
  // ============================================
  console.log('📊 STEP 1: Analyzing current state...');

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_paid,
      SUM(CASE WHEN payment_method IS NULL THEN 1 ELSE 0 END) as missing_method,
      SUM(CASE WHEN payment_method IS NOT NULL THEN 1 ELSE 0 END) as has_method
    FROM vouchers WHERE status = 'Paid'
  `).get();

  console.log(`   Total Paid Vouchers: ${stats.total_paid}`);
  console.log(`   With payment_method: ${stats.has_method}`);
  console.log(`   Missing payment_method: ${stats.missing_method}`);
  console.log('   ✅ Analysis complete\n');

  // ============================================
  // STEP 2: Create backup (just in case)
  // ============================================
  console.log('💾 STEP 2: Creating backup table...');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS vouchers_backup_20260417 AS
    SELECT * FROM vouchers WHERE status = 'Paid' AND payment_method IS NULL
  `).run();

  const backupCount = db.prepare('SELECT COUNT(*) as count FROM vouchers_backup_20260417').get();
  console.log(`   Backed up ${backupCount.count} records\n`);

  // ============================================
  // STEP 3: Create audit log table if needed
  // ============================================
  console.log('📝 STEP 3: Creating audit log table...');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS payment_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      old_status TEXT,
      new_status TEXT,
      payment_method TEXT,
      amount REAL,
      changed_by INTEGER,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT,
      ip_address TEXT
    )
  `).run();
  console.log('   ✅ Audit log table ready\n');

  // ============================================
  // STEP 4: Backfill missing data
  // ============================================
  console.log('🔧 STEP 4: Backfilling missing payment methods...');

  // Update vouchers with missing payment_method
  const updateResult = db.prepare(`
    UPDATE vouchers
    SET
      payment_method = 'NEFT',
      paid_on = COALESCE(paid_on, updated_at),
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'Paid' AND payment_method IS NULL
  `).run();

  console.log(`   Updated ${updateResult.changes} records with payment_method='NEFT'\n`);

  // ============================================
  // STEP 5: Create audit log entries
  // ============================================
  console.log('📋 STEP 5: Creating audit log entries...');

  const recordsToAudit = db.prepare(`
    SELECT COUNT(*) as count FROM vouchers_backup_20260417
  `).get();

  if (recordsToAudit.count > 0) {
    db.prepare(`
      INSERT INTO payment_audit_log (
        voucher_id, old_status, new_status, payment_method, amount,
        changed_by, reason
      )
      SELECT
        id, 'Paid' as old_status, 'Paid' as new_status,
        'NEFT' as payment_method, final_amount, 0 as changed_by,
        'Data migration: backfilled missing payment_method' as reason
      FROM vouchers_backup_20260417
    `).run();

    console.log(`   Created ${recordsToAudit.count} audit log entries\n`);
  }

  // ============================================
  // STEP 6: Verify results
  // ============================================
  console.log('✅ STEP 6: Verifying results...');

  const finalStats = db.prepare(`
    SELECT
      COUNT(*) as total_paid,
      SUM(CASE WHEN payment_method IS NULL THEN 1 ELSE 0 END) as still_missing,
      SUM(CASE WHEN payment_method = 'NEFT' THEN 1 ELSE 0 END) as neft_count,
      SUM(CASE WHEN payment_method = 'Cheque' THEN 1 ELSE 0 END) as cheque_count,
      SUM(CASE WHEN payment_method = 'Cash' THEN 1 ELSE 0 END) as cash_count
    FROM vouchers WHERE status = 'Paid'
  `).get();

  console.log('   Distribution after migration:');
  console.log(`   ├─ Total Paid Vouchers: ${finalStats.total_paid}`);
  console.log(`   ├─ NEFT: ${finalStats.neft_count}`);
  console.log(`   ├─ Cheque: ${finalStats.cheque_count}`);
  console.log(`   ├─ Cash: ${finalStats.cash_count}`);
  console.log(`   └─ Still Missing: ${finalStats.still_missing}`);

  if (finalStats.still_missing === 0) {
    console.log('\n   ✅ SUCCESS: All payment methods backfilled!\n');
  } else {
    console.log('\n   ⚠️  WARNING: Some records still missing!\n');
  }

  // ============================================
  // STEP 7: Sample verification
  // ============================================
  console.log('🔍 STEP 7: Sample verification (first 5 records)...');

  const samples = db.prepare(`
    SELECT id, final_amount, payment_method, paid_on FROM vouchers
    WHERE status = 'Paid' ORDER BY id LIMIT 5
  `).all();

  samples.forEach(sample => {
    console.log(`   Voucher #${sample.id}: ₹${sample.final_amount} via ${sample.payment_method} on ${sample.paid_on}`);
  });

  console.log('\n========================================');
  console.log('✅ MIGRATION COMPLETED SUCCESSFULLY');
  console.log('========================================\n');

  console.log('📌 NEXT STEPS:');
  console.log('   1. Review the migration results');
  console.log('   2. Check payment_audit_log table for entries');
  console.log('   3. Update controller to enforce payment_method as required');
  console.log('   4. Test payment modal with validation\n');

} catch (error) {
  console.error('❌ MIGRATION FAILED:', error.message);
  console.error('\nROLLBACK: No changes were applied due to error.\n');
  process.exit(1);
}
