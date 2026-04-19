const db = require('../database/db');
const path = require('path');
const fs = require('fs');

const LANGUAGES = ['Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Hindi', 'English'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MEMBER_TYPES = ['Ordinary', 'Life', 'Honorary', 'Associate'];

exports.index = async (req, res) => {
  await db.ready;
  const search = req.query.search || '';
  const status = req.query.status || '';
  const stats = await db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN status='Expired' THEN 1 ELSE 0 END) as expired,
    SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM members`).get();
  res.render('members/index', { title: 'All Members', stats, search, status, LANGUAGES });
};

exports.data = async (req, res) => {
  await db.ready;
  try {
    const draw = parseInt(req.query.draw) || 1;
    const start = parseInt(req.query.start) || 0;
    const length = Math.min(parseInt(req.query.length) || 25, 500);
    // Express qs parses search[value] → req.query.search = { value: '...' }
    const searchRaw = req.query.search;
    const search = ((typeof searchRaw === 'object' ? searchRaw?.value : searchRaw) || '').trim();
    const status = req.query.status || '';
    // Express qs parses order[0][column] → req.query.order = [{ column: '0', dir: '...' }]
    const orderArr = Array.isArray(req.query.order) ? req.query.order : [];
    const orderColIdx = parseInt(orderArr[0]?.column) || 0;
    const orderDir = orderArr[0]?.dir === 'desc' ? 'DESC' : 'ASC';
    const colMap = { 0: 'CAST(membership_no AS INTEGER)', 2: 'full_name', 3: 'contact_no', 5: 'slang', 6: 'gender', 7: 'dob', 8: 'status' };
    const orderBy = colMap[orderColIdx] || 'CAST(membership_no AS INTEGER)';

    const whereParts = [];
    const filterParams = [];
    if (search) {
      whereParts.push('(full_name LIKE ? OR membership_no LIKE ? OR contact_no LIKE ?)');
      filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) { whereParts.push('status = ?'); filterParams.push(status); }

    const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
    const batchResults = await db.batch([
      { sql: 'SELECT COUNT(*) as cnt FROM members', args: [] },
      { sql: `SELECT COUNT(*) as cnt FROM members ${where}`, args: filterParams },
      { sql: `SELECT id, membership_no, full_name, contact_no, languages, slang, gender, dob, status, profile_picture
       FROM members ${where} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`,
        args: [...filterParams, length, start] }
    ]);
    const totalRow    = batchResults[0].first() || { cnt: 0 };
    const filteredRow = batchResults[1].first() || { cnt: 0 };
    const rows        = batchResults[2].rows;

    res.json({ draw, recordsTotal: totalRow.cnt, recordsFiltered: filteredRow.cnt, data: rows });
  } catch (e) {
    console.error('Members data error:', e.message);
    res.status(500).json({ draw: parseInt(req.query.draw) || 1, recordsTotal: 0, recordsFiltered: 0, data: [], error: e.message });
  }
};

exports.exportCsv = async (req, res) => {
  await db.ready;
  const search = (req.query.search || '').trim();
  const status = req.query.status || '';
  const whereParts = [];
  const filterParams = [];
  if (search) {
    whereParts.push('(full_name LIKE ? OR membership_no LIKE ? OR contact_no LIKE ?)');
    filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { whereParts.push('status = ?'); filterParams.push(status); }
  const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
  const rows = await db.prepare(
    `SELECT membership_no, full_name, contact_no, whatsapp_no, gender, dob, status, member_type, languages, slang, email, bank_name, bank_account_no, ifsc_code
     FROM members ${where} ORDER BY CAST(membership_no AS INTEGER) ASC`
  ).all(...filterParams);
  const headers = ['Membership No', 'Full Name', 'Contact', 'WhatsApp', 'Gender', 'DOB', 'Status', 'Member Type', 'Languages', 'Slang', 'Email', 'Bank Name', 'Account No', 'IFSC'];
  const fields = ['membership_no', 'full_name', 'contact_no', 'whatsapp_no', 'gender', 'dob', 'status', 'member_type', 'languages', 'slang', 'email', 'bank_name', 'bank_account_no', 'ifsc_code'];
  const csv = [headers.join(','), ...rows.map(r => fields.map(f => JSON.stringify(r[f] ?? '')).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
  res.send(csv);
};

exports.showCreate = async (req, res) => {
  await db.ready;
  const nextNo = await getNextMembershipNo();
  res.render('members/form', {
    title: 'New Member',
    member: { membership_no: nextNo, status: 'Active', member_type: 'Ordinary', languages: '[]' },
    errors: [],
    LANGUAGES, BLOOD_GROUPS, MEMBER_TYPES
  });
};

exports.create = async (req, res) => {
  await db.ready;
  const data = sanitizeMemberData(req.body);
  const errors = validateMember(data);

  if (req.file) data.profile_picture = '/uploads/' + req.file.filename;

  const existing = await db.prepare('SELECT id FROM members WHERE membership_no = ?').get(data.membership_no);
  if (existing) errors.push('Membership number already exists.');

  if (errors.length) {
    if (req.file) deleteFile(req.file.path);
    return res.render('members/form', { title: 'New Member', member: data, errors, LANGUAGES, BLOOD_GROUPS, MEMBER_TYPES });
  }

  await db.prepare(`INSERT INTO members
    (membership_no, full_name, whatsapp_no, address, slang, languages, admission_year, gender, dob,
     contact_no, blood_group, email, aadhaar_no, bank_name, bank_account_no, ifsc_code,
     qualification, years_experience, status, family_members, nominee, member_type, profile_picture, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    data.membership_no, data.full_name, data.whatsapp_no, data.address, data.slang,
    JSON.stringify(data.languages), data.admission_year, data.gender, data.dob,
    data.contact_no, data.blood_group, data.email, data.aadhaar_no, data.bank_name,
    data.bank_account_no, data.ifsc_code, data.qualification, data.years_experience,
    data.status, data.family_members, data.nominee, data.member_type,
    data.profile_picture, data.notes
  );

  req.flash('success', `Member "${data.full_name}" created successfully.`);
  if (req.body._action === 'create_close') return res.redirect('/members');
  const created = await db.prepare('SELECT id FROM members WHERE membership_no = ?').get(data.membership_no);
  res.redirect(`/members/${created.id}`);
};

exports.show = async (req, res) => {
  await db.ready;
  const member = await db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.flash('error', 'Member not found.'); return res.redirect('/members'); }
  member.languages = safeParseJSON(member.languages, []);

  const vouchers = await db.prepare(`SELECT v.id, v.status, v.amount, v.final_amount, v.character,
    v.gw_fund_amount, v.representative_amount, v.payment_method, v.paid_on,
    COALESCE(v.voucher_date, date(v.created_at)) as voucher_date, p.film_name
    FROM vouchers v LEFT JOIN projects p ON v.project_id = p.id
    WHERE v.member_id = ? ORDER BY COALESCE(v.voucher_date, v.created_at) DESC`).all(member.id);

  const voucherStats = {
    total: vouchers.length,
    paid: vouchers.filter(v => v.status === 'Paid').length,
    pending: vouchers.filter(v => v.status === 'Pending').length,
    total_paid_amount: vouchers.filter(v => v.status === 'Paid').reduce((s, v) => s + (v.final_amount || 0), 0),
    total_pending_amount: vouchers.filter(v => v.status === 'Pending').reduce((s, v) => s + (v.final_amount || 0), 0)
  };

  res.render('members/show', { title: member.full_name, member, vouchers, voucherStats });
};

exports.showEdit = async (req, res) => {
  await db.ready;
  const member = await db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.flash('error', 'Member not found.'); return res.redirect('/members'); }
  member.languages = safeParseJSON(member.languages, []);
  res.render('members/form', { title: 'Edit Member', member, errors: [], isEdit: true, LANGUAGES, BLOOD_GROUPS, MEMBER_TYPES });
};

exports.update = async (req, res) => {
  await db.ready;
  const member = await db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.flash('error', 'Member not found.'); return res.redirect('/members'); }

  const data = sanitizeMemberData(req.body);
  const errors = validateMember(data, member.id);

  if (req.file) {
    data.profile_picture = '/uploads/' + req.file.filename;
    if (member.profile_picture) deleteFile(path.join('./public', member.profile_picture));
  } else {
    data.profile_picture = member.profile_picture;
  }

  if (errors.length) {
    if (req.file) deleteFile(req.file.path);
    data.id = member.id;
    return res.render('members/form', { title: 'Edit Member', member: data, errors, isEdit: true, LANGUAGES, BLOOD_GROUPS, MEMBER_TYPES });
  }

  await db.prepare(`UPDATE members SET
    membership_no=?, full_name=?, whatsapp_no=?, address=?, slang=?, languages=?,
    admission_year=?, gender=?, dob=?, contact_no=?, blood_group=?, email=?,
    aadhaar_no=?, bank_name=?, bank_account_no=?, ifsc_code=?, qualification=?,
    years_experience=?, status=?, family_members=?, nominee=?, member_type=?,
    profile_picture=?, notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`
  ).run(
    data.membership_no, data.full_name, data.whatsapp_no, data.address, data.slang,
    JSON.stringify(data.languages), data.admission_year, data.gender, data.dob,
    data.contact_no, data.blood_group, data.email, data.aadhaar_no, data.bank_name,
    data.bank_account_no, data.ifsc_code, data.qualification, data.years_experience,
    data.status, data.family_members, data.nominee, data.member_type,
    data.profile_picture, data.notes, member.id
  );

  req.flash('success', 'Member updated successfully.');
  res.redirect(`/members/${member.id}`);
};

exports.destroy = async (req, res) => {
  await db.ready;
  const member = await db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.flash('error', 'Member not found.'); return res.redirect('/members'); }

  const row = await db.prepare('SELECT COUNT(*) as cnt FROM vouchers WHERE member_id = ?').get(member.id);
  const voucherCount = row.cnt;
  if (voucherCount > 0) {
    req.flash('error', `Cannot delete: member has ${voucherCount} voucher(s).`);
    return res.redirect(`/members/${member.id}`);
  }

  if (member.profile_picture) deleteFile(path.join('./public', member.profile_picture));
  await db.prepare('DELETE FROM members WHERE id = ?').run(member.id);
  req.flash('success', `Member "${member.full_name}" deleted.`);
  res.redirect('/members');
};

// ---- Helpers ----
function sanitizeMemberData(body) {
  const langs = Array.isArray(body.languages) ? body.languages : (body.languages ? [body.languages] : []);
  return {
    membership_no: (body.membership_no || '').trim(),
    full_name: (body.full_name || '').trim(),
    whatsapp_no: (body.whatsapp_no || '').trim() || null,
    address: (body.address || '').trim() || null,
    slang: (body.slang || '').trim() || null,
    languages: langs,
    admission_year: body.admission_year ? parseInt(body.admission_year) : null,
    gender: body.gender || null,
    dob: body.dob || null,
    contact_no: (body.contact_no || '').trim() || null,
    blood_group: body.blood_group || null,
    email: (body.email || '').trim().toLowerCase() || null,
    aadhaar_no: (body.aadhaar_no || '').trim() || null,
    bank_name: (body.bank_name || '').trim() || null,
    bank_account_no: (body.bank_account_no || '').trim() || null,
    ifsc_code: (body.ifsc_code || '').toUpperCase().trim() || null,
    qualification: (body.qualification || '').trim() || null,
    years_experience: body.years_experience ? parseInt(body.years_experience) : null,
    status: body.status || 'Active',
    family_members: (body.family_members || '').trim() || null,
    nominee: (body.nominee || '').trim() || null,
    member_type: body.member_type || 'Ordinary',
    profile_picture: null,
    notes: (body.notes || '').trim() || null
  };
}

function validateMember(data, excludeId = null) {
  const errors = [];
  if (!data.membership_no) errors.push('Membership number is required.');
  if (!data.full_name || data.full_name.length < 2) errors.push('Full name is required.');
  if (!['Active','Expired','Cancelled'].includes(data.status)) errors.push('Invalid status.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Invalid email address.');
  return errors;
}

async function getNextMembershipNo() {
  const last = await db.prepare('SELECT membership_no FROM members ORDER BY CAST(membership_no AS INTEGER) DESC LIMIT 1').get();
  if (!last) return '1001';
  const n = parseInt(last.membership_no);
  return isNaN(n) ? '' : String(n + 1);
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function deleteFile(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}
