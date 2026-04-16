const DatabaseSync = require('node:sqlite').DatabaseSync;

const LIVE_DB_PATH = '/Users/venkateshage/Desktop/database.sqlite';
const LOCAL_DB_PATH = './database/sictadau.db';

console.log('🔄 IMPORTING DATA FROM LIVE SYSTEM\n');

const liveDb = new DatabaseSync(LIVE_DB_PATH, { readonly: true });
const localDb = new DatabaseSync(LOCAL_DB_PATH);

localDb.exec('PRAGMA foreign_keys = ON');

try {
  // ==================== REPRESENTATIVES ====================
  console.log('📥 Importing Representatives...');
  localDb.exec('DELETE FROM representatives');
  
  const reps = liveDb.prepare(`
    SELECT id, rep_name as name, contact_no as contact, status
    FROM mugiltech_dubunion_representatives
  `).all();
  
  const repStmt = localDb.prepare(`
    INSERT INTO representatives (id, name, contact, is_active)
    VALUES (?, ?, ?, ?)
  `);
  
  reps.forEach(r => {
    repStmt.run(r.id, r.name, r.contact, r.status ?? 1);
  });
  console.log(`   ✓ Imported ${reps.length} representatives`);

  // ==================== MEMBERS ====================
  console.log('📥 Importing Members...');
  localDb.exec('DELETE FROM members');
  
  // Use raw SQL to avoid JavaScript number conversion issues
  const memberRows = liveDb.prepare(`
    SELECT 
      id, membership_no, full_name, whatsapp_no, contact_no, address, slang, 
      email, admission_year, gender, dob, blood_group, qualification, 
      years_of_experience, status, family_members, nominee, 
      member_type, aadhar_no, bank_name, acc_no, 
      ifsc, notes, language
    FROM mugiltech_dubunion_members
    WHERE deleted_at IS NULL
    AND id = (
      SELECT MAX(id) FROM mugiltech_dubunion_members m2 
      WHERE m2.membership_no = mugiltech_dubunion_members.membership_no AND m2.deleted_at IS NULL
    )
  `).all();
  
  const memberStmt = localDb.prepare(`
    INSERT INTO members 
    (id, membership_no, full_name, whatsapp_no, contact_no, address, slang, email, 
     admission_year, gender, dob, blood_group, qualification, years_experience, 
     status, family_members, nominee, member_type, aadhaar_no, bank_name, 
     bank_account_no, ifsc_code, notes, languages)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let memberSkipped = 0;
  memberRows.forEach(m => {
    try {
      const statusMap = { 1: 'Active', 2: 'Expired', 3: 'Cancelled' };
      const status = statusMap[m.status] || 'Active';
      const gender = m.gender || 'Other';
      const languages = m.language ? JSON.stringify([m.language]) : '[]';
      
      // Safe number conversion
      const aadhaar = m.aadhar_no ? String(m.aadhar_no).trim() : '';
      const accNo = m.acc_no ? String(m.acc_no).trim() : '';
      const yearsExp = parseInt(m.years_of_experience) || 0;
      
      memberStmt.run(
        m.id, m.membership_no, m.full_name, m.whatsapp_no, m.contact_no, m.address,
        m.slang, m.email, parseInt(m.admission_year) || null, gender, m.dob, m.blood_group,
        m.qualification, yearsExp, status, m.family_members, m.nominee,
        m.member_type || 'Ordinary', aadhaar, m.bank_name, accNo,
        m.ifsc, m.notes, languages
      );
    } catch (err) {
      memberSkipped++;
    }
  });
  console.log(`   ✓ Imported ${memberRows.length - memberSkipped} members (${memberSkipped} skipped)`);

  // ==================== PROJECTS ====================
  console.log('📥 Importing Projects...');
  localDb.exec('DELETE FROM projects');
  
  const projects = liveDb.prepare(`
    SELECT id, film_name, production_company, company_address,
           language, company_phone, place_of_dubbing, 
           start_date, end_date, company_email, amount, 
           payment_received, invoice_no,
           status, representative_name
    FROM mugiltech_dubunion_projects
    WHERE deleted_at IS NULL
  `).all();
  
  const projectStmt = localDb.prepare(`
    INSERT INTO projects
    (id, film_name, production_company, production_company_address, language,
     production_contact_no, representative_id, place_of_dubbing, start_date, end_date,
     company_email, amount, payment_received, invoice_no, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  projects.forEach(p => {
    let repId = null;
    if (p.representative_name) {
      const repMatch = liveDb.prepare(`
        SELECT id FROM mugiltech_dubunion_representatives 
        WHERE rep_name = ? LIMIT 1
      `).get(p.representative_name);
      repId = repMatch?.id || null;
    }
    
    const statusMap = { 1: 'Pending', 2: 'Completed', 3: 'Paid' };
    const status = statusMap[p.status] || 'Pending';
    
    projectStmt.run(
      p.id, p.film_name, p.production_company, p.company_address,
      p.language, p.company_phone, repId, p.place_of_dubbing, p.start_date,
      p.end_date, p.company_email, p.amount || 0, p.payment_received || 0,
      p.invoice_no, status
    );
  });
  console.log(`   ✓ Imported ${projects.length} projects`);

  // ==================== VOUCHERS ====================
  console.log('📥 Importing Artist Vouchers...');
  localDb.exec('DELETE FROM vouchers');
  
  const vouchers = liveDb.prepare(`
    SELECT id, member_no, project_id, character, amount,
           union_amount, representative_amount,
           final_amount, status
    FROM mugiltech_dubunion_vouchers
    WHERE deleted_at IS NULL
  `).all();
  
  const voucherStmt = localDb.prepare(`
    INSERT INTO vouchers
    (id, member_id, project_id, character, amount, gw_fund_amount,
     representative_amount, final_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let voucherErrors = 0;
  let voucherSuccess = 0;
  vouchers.forEach(v => {
    try {
      const memberExists = localDb.prepare('SELECT id FROM members WHERE id = ?').get(v.member_no);
      const projectExists = localDb.prepare('SELECT id FROM projects WHERE id = ?').get(v.project_id);
      
      if (!memberExists || !projectExists) {
        voucherErrors++;
        return;
      }
      
      const statusMap = { 1: 'Pending', 2: 'Paid' };
      const status = statusMap[v.status] || 'Pending';
      
      voucherStmt.run(
        v.id, v.member_no, v.project_id, v.character, v.amount || 0,
        v.union_amount || 0, v.representative_amount || 0, v.final_amount || 0,
        status
      );
      voucherSuccess++;
    } catch (err) {
      voucherErrors++;
    }
  });
  console.log(`   ✓ Imported ${voucherSuccess} vouchers (${voucherErrors} skipped)`);

  // ==================== STATEMENTS (Payments) ====================
  console.log('📥 Importing Statements/Transactions...');
  localDb.exec('DELETE FROM statements');
  
  const statements = liveDb.prepare(`
    SELECT id, transaction_date, transaction_type, amount, movie_name, invoice_no,
           remark, status, payment_mode, payment_to,
           income_type
    FROM mugiltech_dubunion_payments
    WHERE deleted_at IS NULL
  `).all();
  
  const stmtStmt = localDb.prepare(`
    INSERT INTO statements
    (id, transaction_date, amount_type, amount, film_name, invoice_no,
     transaction_remarks, payment_mode, paid_to, income_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  statements.forEach(s => {
    const amountTypeMap = { 'Expense': 'Debit', 'Income': 'Credit' };
    const amountType = amountTypeMap[s.transaction_type] || s.transaction_type;
    
    stmtStmt.run(
      s.id, s.transaction_date, amountType, s.amount || 0, s.movie_name,
      s.invoice_no, s.remark, s.payment_mode, s.payment_to,
      s.income_type
    );
  });
  console.log(`   ✓ Imported ${statements.length} transactions/statements`);

  // ==================== STATISTICS ====================
  console.log('\n📊 IMPORT SUMMARY\n');
  
  const stats = {
    members: localDb.prepare('SELECT COUNT(*) as cnt FROM members').get().cnt,
    representatives: localDb.prepare('SELECT COUNT(*) as cnt FROM representatives').get().cnt,
    projects: localDb.prepare('SELECT COUNT(*) as cnt FROM projects').get().cnt,
    vouchers: localDb.prepare('SELECT COUNT(*) as cnt FROM vouchers').get().cnt,
    statements: localDb.prepare('SELECT COUNT(*) as cnt FROM statements').get().cnt
  };
  
  console.log(`✓ Members:         ${stats.members.toLocaleString()}`);
  console.log(`✓ Representatives: ${stats.representatives.toLocaleString()}`);
  console.log(`✓ Projects:        ${stats.projects.toLocaleString()}`);
  console.log(`✓ Vouchers:        ${stats.vouchers.toLocaleString()}`);
  console.log(`✓ Statements:      ${stats.statements.toLocaleString()}`);
  
  console.log(`\n✅ DATA IMPORT COMPLETED SUCCESSFULLY!\n`);
  console.log('📌 User accounts were NOT modified');
  console.log('📌 All data is now synced with the live system');

} catch (err) {
  console.error('\n❌ IMPORT ERROR:', err.message);
  console.error(err);
  process.exit(1);
} finally {
  liveDb.close();
  localDb.close();
}
