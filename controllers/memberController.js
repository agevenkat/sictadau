const db = require('../database/db');
const path = require('path');
const fs = require('fs');

const LANGUAGES = ['Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Hindi', 'English'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MEMBER_TYPES = ['Ordinary', 'Life', 'Honorary', 'Associate'];

exports.index = (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';
  let query = `SELECT id, membership_no, full_name, contact_no, languages, slang, gender, dob, status, profile_picture
               FROM members WHERE 1=1`;
  const params = [];

  if (search) {
    query += ` AND (full_name LIKE ? OR membership_no LIKE ? OR contact_no LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  query += ' ORDER BY CAST(membership_no AS INTEGER)';

  const members = db.prepare(query).all(...params);
  const stats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN status='Expired' THEN 1 ELSE 0 END) as expired,
    SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM members`).get();

  res.render('members/index', { title: 'All Members', members, stats, search, status, LANGUAGES });
};

exports.showCreate = (req, res) => {
  const nextNo = getNextMembershipNo();
  res.render('members/form', {
    title: 'New Member',
    member: { membership_no: nextNo, status: 'Active', member_type: 'Ordinary', languages: '[]' },
    errors: [],
    LANGUAGES, BLOOD_GROUPS, MEMBER_TYPES
  });
};

exports.create = (req, res) => {
  const data = sanitizeMemberData(req.body);
  const errors = validateMember(data);

  if (req.file) data.profile_picture = '/uploads/' + req.file.filename;

  const existing = db.prepare('SELECT id FROM members WHERE membership_no = ?').get(data.membership_no);
  if (existing) errors.push('Membership number already exists.');

  if (errors.length) {
    if (req.file) deleteFile(req.file.path);
    return res.render('members/form', { title: 'New Member', member: data, errors, LANGUAGES, BLOOD_GROUPS, MEMBER_TYPES });
  }

  db.prepare(`INSERT INTO members
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
  const created = db.prepare('SELECT id FROM members WHERE membership_no = ?').get(data.membership_no);
  res.redirect(`/members/${created.id}`);
};

exports.show = (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.flash('error', 'Member not found.'); return res.redirect('/members'); }
  member.languages = safeParseJSON(member.languages, []);

  const vouchers = db.prepare(`SELECT v.*, p.film_name FROM vouchers v
    LEFT JOIN projects p ON v.project_id = p.id
    WHERE v.member_id = ? ORDER BY v.created_at DESC LIMIT 10`).all(member.id);

  res.render('members/show', { title: member.full_name, member, vouchers });
};

exports.showEdit = (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.flash('error', 'Member not found.'); return res.redirect('/members'); }
  member.languages = safeParseJSON(member.languages, []);
  res.render('members/form', { title: 'Edit Member', member, errors: [], isEdit: true, LANGUAGES, BLOOD_GROUPS, MEMBER_TYPES });
};

exports.update = (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
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

  db.prepare(`UPDATE members SET
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

exports.destroy = (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.flash('error', 'Member not found.'); return res.redirect('/members'); }

  const voucherCount = db.prepare('SELECT COUNT(*) as cnt FROM vouchers WHERE member_id = ?').get(member.id).cnt;
  if (voucherCount > 0) {
    req.flash('error', `Cannot delete: member has ${voucherCount} voucher(s).`);
    return res.redirect(`/members/${member.id}`);
  }

  if (member.profile_picture) deleteFile(path.join('./public', member.profile_picture));
  db.prepare('DELETE FROM members WHERE id = ?').run(member.id);
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

function getNextMembershipNo() {
  const last = db.prepare('SELECT membership_no FROM members ORDER BY CAST(membership_no AS INTEGER) DESC LIMIT 1').get();
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
