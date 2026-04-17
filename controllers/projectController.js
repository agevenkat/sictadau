const db = require('../database/db');
const path = require('path');
const fs = require('fs');

const LANGUAGES = ['Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Hindi', 'English'];
const STATUSES = ['Pending', 'Completed', 'Paid'];

exports.index = (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';
  let query = `SELECT p.*, r.name as rep_name FROM projects p
               LEFT JOIN representatives r ON p.representative_id = r.id WHERE 1=1`;
  const params = [];

  if (search) {
    query += ` AND (p.film_name LIKE ? OR p.production_company LIKE ? OR p.invoice_no LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { query += ` AND p.status = ?`; params.push(status); }
  query += ' ORDER BY p.start_date DESC, p.id DESC';

  const projects = db.prepare(query).all(...params);
  const stats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(amount) as total_amount,
    SUM(payment_received) as total_received,
    SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='Paid' THEN 1 ELSE 0 END) as paid
    FROM projects`).get();

  res.render('projects/index', { title: 'Working Reports', projects, stats, search, status, STATUSES });
};

exports.showCreate = (req, res) => {
  const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
  res.render('projects/form', {
    title: 'New Working Report',
    project: { status: 'Pending', amount: 0 },
    reps, LANGUAGES, STATUSES, errors: []
  });
};

exports.create = (req, res) => {
  try {
    const data = sanitize(req.body);
    const validation = validate(data);
    const errors = validation.errors || [];
    const warnings = validation.warnings || [];

    if (req.files) {
      if (req.files.representative_form?.[0]) data.representative_form = '/uploads/' + req.files.representative_form[0].filename;
      if (req.files.working_report_file?.[0]) data.working_report_file = '/uploads/' + req.files.working_report_file[0].filename;
    }

    if (errors.length) {
      const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
      return res.render('projects/form', { title: 'New Working Report', project: data, reps, LANGUAGES, STATUSES, errors, warnings });
    }

    // ✅ Show warnings if project has zero amount
    if (warnings.length) {
      warnings.forEach(w => req.flash('warning', w));
    }

    const result = db.prepare(`INSERT INTO projects
      (film_name, production_company, production_company_address, language, production_contact_no,
       representative_id, place_of_dubbing, start_date, end_date, company_email, amount,
       payment_received, invoice_no, representative_form, working_report_file, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      data.film_name, data.production_company, data.production_company_address, data.language,
      data.production_contact_no, data.representative_id, data.place_of_dubbing, data.start_date,
      data.end_date, data.company_email, data.amount, data.payment_received, data.invoice_no,
      data.representative_form, data.working_report_file, data.status
    );

    req.flash('success', `Project "${data.film_name}" created successfully.`);
    if (req.body._action === 'create_close') return res.redirect('/projects');
    res.redirect(`/projects/${result.lastInsertRowid}`);
  } catch (err) {
    console.error('Project create error:', err.message);
    const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
    const data = sanitize(req.body);
    req.flash('error', `Failed to create project: ${err.message}`);
    res.render('projects/form', {
      title: 'New Working Report',
      project: data,
      reps,
      LANGUAGES,
      STATUSES,
      errors: [`Database error: ${err.message}`]
    });
  }
};

exports.show = (req, res) => {
  const project = db.prepare(`SELECT p.*, r.name as rep_name FROM projects p
    LEFT JOIN representatives r ON p.representative_id = r.id WHERE p.id = ?`).get(req.params.id);
  if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }

  const vouchers = db.prepare(`SELECT v.*, m.full_name, m.membership_no, m.bank_account_no, m.ifsc_code, m.bank_name
    FROM vouchers v JOIN members m ON v.member_id = m.id WHERE v.project_id = ? ORDER BY v.id`).all(project.id);

  const payments = db.prepare('SELECT * FROM project_payments WHERE project_id = ? ORDER BY transaction_date').all(project.id);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  res.render('projects/show', { title: project.film_name, project, vouchers, payments, totalPaid });
};

exports.invoice = (req, res) => {
  const project = db.prepare(`SELECT p.*, r.name as rep_name FROM projects p
    LEFT JOIN representatives r ON p.representative_id = r.id WHERE p.id = ?`).get(req.params.id);
  if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }

  const vouchers = db.prepare(`SELECT v.*, m.full_name, m.membership_no FROM vouchers v
    JOIN members m ON v.member_id = m.id WHERE v.project_id = ? ORDER BY v.id`).all(project.id);

  const payments = db.prepare('SELECT * FROM project_payments WHERE project_id = ? ORDER BY transaction_date').all(project.id);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  res.render('projects/invoice', { title: `Invoice — ${project.film_name}`, project, vouchers, payments, totalPaid, layout: false });
};

exports.downloadInvoice = (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const project = db.prepare(`SELECT p.*, r.name as rep_name FROM projects p
      LEFT JOIN representatives r ON p.representative_id = r.id WHERE p.id = ?`).get(req.params.id);
    if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }

    const vouchers = db.prepare(`SELECT v.*, m.full_name, m.membership_no FROM vouchers v
      JOIN members m ON v.member_id = m.id WHERE v.project_id = ? ORDER BY v.id`).all(project.id);

    const payments = db.prepare('SELECT * FROM project_payments WHERE project_id = ? ORDER BY transaction_date').all(project.id);
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const balance = (project.amount || 0) - (project.payment_received || 0);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const filename = `Invoice-${project.id}-${project.film_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const BLUE = '#303493';
    const RED = '#EE3134';
    const pageW = doc.page.width - 80; // usable width

    // ---- Header ----
    doc.fontSize(13).fillColor(BLUE).font('Helvetica-Bold')
       .text('South Indian Cine, Television Artistes', 40, 40)
       .text('and Dubbing Artistes Union', 40, 56);
    doc.fontSize(8).fillColor('#555').font('Helvetica')
       .text('ESTD: 1983  |  Regd No. 1337/MDS  |  Affiliated with FEFSI', 40, 74)
       .text('10, Vijayaraghavapuram 4th Street, Saligamam, Chennai-600093', 40, 86)
       .text('044-23650223 / 23650225 / 23650229  |  sictadau@gmail.com', 40, 98);

    // Invoice info (right side)
    doc.fontSize(10).fillColor('#000').font('Helvetica-Bold')
       .text(`Invoice No: ${project.id}`, 400, 40, { align: 'right', width: 155 });
    doc.fontSize(9).fillColor(project.status === 'Paid' ? BLUE : RED).font('Helvetica-Bold')
       .text(`Status: ${project.status}`, 400, 56, { align: 'right', width: 155 });
    doc.fontSize(8).fillColor('#555').font('Helvetica')
       .text(`Start: ${project.start_date || '—'}`, 400, 72, { align: 'right', width: 155 })
       .text(`End:   ${project.end_date || '—'}`, 400, 84, { align: 'right', width: 155 });

    // Divider
    doc.moveTo(40, 116).lineTo(555, 116).strokeColor(BLUE).lineWidth(2).stroke();
    let y = 126;

    // ---- From / To ----
    doc.fontSize(8).fillColor(BLUE).font('Helvetica-Bold').text('FROM:', 40, y).text('TO:', 300, y);
    y += 14;
    doc.fontSize(9).fillColor('#000').font('Helvetica-Bold')
       .text('SICTADAU', 40, y)
       .text(project.production_company, 300, y);
    y += 13;
    doc.fontSize(8).fillColor('#333').font('Helvetica')
       .text('Chennai-600093', 40, y)
       .text(`Film: ${project.film_name}`, 300, y);
    y += 11;
    doc.text('', 40, y)
       .text(`Language: ${project.language || '—'}`, 300, y);
    y += 11;
    doc.text('', 40, y)
       .text(`POD: ${project.place_of_dubbing || '—'}`, 300, y);
    y += 11;
    doc.text('', 40, y)
       .text(`Contact: ${project.production_contact_no || '—'}`, 300, y);
    y += 11;
    doc.text('', 40, y)
       .text(`Representative: ${project.rep_name || '—'}`, 300, y);
    y += 18;

    // ---- Summary boxes ----
    const boxW = pageW / 4;
    const boxes = [
      { label: 'TOTAL AMOUNT', value: `Rs.${(project.amount||0).toLocaleString('en-IN')}` },
      { label: 'AMOUNT RECEIVED', value: `Rs.${(project.payment_received||0).toLocaleString('en-IN')}` },
      { label: 'BALANCE', value: `Rs.${balance.toLocaleString('en-IN')}`, red: balance > 0 },
      { label: 'TOTAL ARTISTS', value: `${vouchers.length}` },
    ];
    boxes.forEach((b, i) => {
      const bx = 40 + i * (boxW + 2);
      doc.rect(bx, y, boxW, 36).fillColor(BLUE).fill();
      doc.fontSize(7).fillColor('#ccc').font('Helvetica').text(b.label, bx + 4, y + 5, { width: boxW - 8, align: 'center' });
      doc.fontSize(11).fillColor(b.red ? RED : '#fff').font('Helvetica-Bold')
         .text(b.value, bx + 4, y + 17, { width: boxW - 8, align: 'center' });
    });
    y += 46;

    // ---- Artist Vouchers table ----
    doc.moveTo(40, y).lineTo(555, y).strokeColor(BLUE).lineWidth(1).stroke();
    y += 6;
    doc.fontSize(9).fillColor(BLUE).font('Helvetica-Bold').text(`Artist Vouchers (${vouchers.length})`, 40, y);
    y += 14;

    // Table header
    const cols = [40, 80, 150, 330, 430];
    const colW = [38, 68, 178, 98, 80];
    const headers = ['ID', 'Mem No.', 'Artist Name', 'Character', 'Amount'];
    doc.rect(40, y, pageW, 16).fillColor(BLUE).fill();
    headers.forEach((h, i) => {
      doc.fontSize(8).fillColor('#fff').font('Helvetica-Bold')
         .text(h, cols[i] + 2, y + 3, { width: colW[i] - 4, align: i === 4 ? 'right' : 'left' });
    });
    y += 16;

    if (vouchers.length === 0) {
      doc.fontSize(8).fillColor('#999').font('Helvetica').text('No vouchers added yet', 40, y + 4, { align: 'center', width: pageW });
      y += 18;
    } else {
      vouchers.forEach((v, idx) => {
        if (y > 720) { doc.addPage(); y = 40; }
        if (idx % 2 === 0) { doc.rect(40, y, pageW, 14).fillColor('#f5f5f5').fill(); }
        doc.fontSize(7.5).fillColor('#000').font('Helvetica')
           .text(String(v.id), cols[0] + 2, y + 2, { width: colW[0] - 4 })
           .text(v.membership_no || '', cols[1] + 2, y + 2, { width: colW[1] - 4 })
           .text(v.full_name || '', cols[2] + 2, y + 2, { width: colW[2] - 4 })
           .text(v.character || '—', cols[3] + 2, y + 2, { width: colW[3] - 4 })
           .text(`Rs.${(v.amount||0).toLocaleString('en-IN')}`, cols[4] + 2, y + 2, { width: colW[4] - 4, align: 'right' });
        y += 14;
      });
      // Total row
      const vTotal = vouchers.reduce((s, v) => s + (v.amount || 0), 0);
      doc.rect(40, y, pageW, 14).fillColor('#e8e9f8').fill();
      doc.fontSize(8).fillColor(BLUE).font('Helvetica-Bold')
         .text('Total', 40, y + 2, { width: pageW - 84, align: 'right' })
         .text(`Rs.${vTotal.toLocaleString('en-IN')}`, cols[4] + 2, y + 2, { width: colW[4] - 4, align: 'right' });
      y += 20;
    }

    // ---- Bank details ----
    if (y > 680) { doc.addPage(); y = 40; }
    doc.rect(40, y, pageW, 58).fillColor('#f5f7ff').fill();
    doc.moveTo(40, y).lineTo(40, y + 58).strokeColor(BLUE).lineWidth(3).stroke();
    y += 6;
    doc.fontSize(7.5).fillColor('#000').font('Helvetica');
    const bankLines = [
      'A/C Name : South Indian Cine, Television Artistes and Dubbing Artistes Union',
      'A/C NO.  : 1616135000004793        IFSC CODE : KVBL0001616',
      'BANK     : KARUR VYSYA BANK, K.K.Nagar Branch',
      'PAN NO.  : AADAS9061M',
    ];
    bankLines.forEach(line => { doc.text(line, 50, y, { width: pageW - 14 }); y += 11; });
    y += 10;

    // ---- Payment history ----
    if (payments.length > 0) {
      if (y > 680) { doc.addPage(); y = 40; }
      doc.moveTo(40, y).lineTo(555, y).strokeColor(BLUE).lineWidth(1).stroke();
      y += 6;
      doc.fontSize(9).fillColor(BLUE).font('Helvetica-Bold').text('Payment History', 40, y);
      y += 14;

      const pCols = [40, 90, 190, 290, 400];
      const pColW = [48, 98, 98, 108, 115];
      const pHeaders = ['ID', 'Date', 'Type', 'Notes', 'Amount'];
      doc.rect(40, y, pageW, 16).fillColor(BLUE).fill();
      pHeaders.forEach((h, i) => {
        doc.fontSize(8).fillColor('#fff').font('Helvetica-Bold')
           .text(h, pCols[i] + 2, y + 3, { width: pColW[i] - 4, align: i === 4 ? 'right' : 'left' });
      });
      y += 16;

      payments.forEach((p, idx) => {
        if (y > 720) { doc.addPage(); y = 40; }
        if (idx % 2 === 0) { doc.rect(40, y, pageW, 14).fillColor('#f5f5f5').fill(); }
        doc.fontSize(7.5).fillColor('#000').font('Helvetica')
           .text(String(p.id), pCols[0] + 2, y + 2, { width: pColW[0] - 4 })
           .text(p.transaction_date || '', pCols[1] + 2, y + 2, { width: pColW[1] - 4 })
           .text(p.payment_type || '', pCols[2] + 2, y + 2, { width: pColW[2] - 4 })
           .text(p.notes || '—', pCols[3] + 2, y + 2, { width: pColW[3] - 4 })
           .text(`Rs.${p.amount.toLocaleString('en-IN')}`, pCols[4] + 2, y + 2, { width: pColW[4] - 4, align: 'right' });
        y += 14;
      });
      doc.rect(40, y, pageW, 14).fillColor(BLUE).fill();
      doc.fontSize(8).fillColor('#fff').font('Helvetica-Bold')
         .text('Total Amount Received', 40, y + 2, { width: pageW - 84, align: 'right' })
         .text(`Rs.${totalPaid.toLocaleString('en-IN')}`, pCols[4] + 2, y + 2, { width: pColW[4] - 4, align: 'right' });
      y += 20;
    }

    // ---- Signatures ----
    if (y > 680) { doc.addPage(); y = 40; }
    y += 10;
    doc.moveTo(40, y).lineTo(555, y).strokeColor(BLUE).lineWidth(1).stroke();
    y += 30;
    const sigX = [60, 220, 390];
    const sigLabels = ['Co-ordinator\nMr.C.D.Ananthraman', 'Manager / Secretary\nTreasurer', `For\n${project.production_company}`];
    sigLabels.forEach((label, i) => {
      doc.moveTo(sigX[i], y).lineTo(sigX[i] + 120, y).strokeColor('#000').lineWidth(1).stroke();
      doc.fontSize(7.5).fillColor('#000').font('Helvetica').text(label, sigX[i], y + 4, { width: 120, align: 'center' });
    });
    y += 30;
    doc.fontSize(7).fillColor('#999').font('Helvetica-Oblique')
       .text('*Cheque subject to realisation', 40, y, { align: 'center', width: pageW });

    doc.end();
  } catch (err) {
    console.error('Download invoice error:', err);
    req.flash('error', 'Error generating invoice.');
    res.redirect('/projects');
  }
};

exports.showEdit = (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }
  const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
  res.render('projects/form', { title: 'Edit Working Report', project, reps, LANGUAGES, STATUSES, errors: [], isEdit: true });
};

exports.update = (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }

    const data = sanitize(req.body);
    const validation = validate(data);
    const errors = validation.errors || [];
    const warnings = validation.warnings || [];

    if (req.files) {
      if (req.files.representative_form?.[0]) {
        if (project.representative_form) deleteFile(path.join('./public', project.representative_form));
        data.representative_form = '/uploads/' + req.files.representative_form[0].filename;
      } else { data.representative_form = project.representative_form; }
      if (req.files.working_report_file?.[0]) {
        if (project.working_report_file) deleteFile(path.join('./public', project.working_report_file));
        data.working_report_file = '/uploads/' + req.files.working_report_file[0].filename;
      } else { data.working_report_file = project.working_report_file; }
    } else {
      data.representative_form = project.representative_form;
      data.working_report_file = project.working_report_file;
    }

    if (errors.length) {
      const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
      return res.render('projects/form', { title: 'Edit Working Report', project: { ...project, ...data }, reps, LANGUAGES, STATUSES, errors, warnings, isEdit: true });
    }

    // ✅ Show warnings if project has zero amount
    if (warnings.length) {
      warnings.forEach(w => req.flash('warning', w));
    }

    db.prepare(`UPDATE projects SET film_name=?, production_company=?, production_company_address=?,
      language=?, production_contact_no=?, representative_id=?, place_of_dubbing=?, start_date=?,
      end_date=?, company_email=?, amount=?, payment_received=?, invoice_no=?,
      representative_form=?, working_report_file=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(
      data.film_name, data.production_company, data.production_company_address, data.language,
      data.production_contact_no, data.representative_id, data.place_of_dubbing, data.start_date,
      data.end_date, data.company_email, data.amount, data.payment_received, data.invoice_no,
      data.representative_form, data.working_report_file, data.status, project.id
    );

    req.flash('success', 'Project updated successfully.');
    res.redirect(`/projects/${project.id}`);
  } catch (err) {
    console.error('Project update error:', err.message);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    const reps = db.prepare('SELECT id, name FROM representatives WHERE is_active=1 ORDER BY name').all();
    const data = sanitize(req.body);
    req.flash('error', `Failed to update project: ${err.message}`);
    res.render('projects/form', {
      title: 'Edit Working Report',
      project: { ...project, ...data },
      reps,
      LANGUAGES,
      STATUSES,
      errors: [`Database error: ${err.message}`],
      isEdit: true
    });
  }
};

exports.destroy = (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }
  const vCount = db.prepare('SELECT COUNT(*) as cnt FROM vouchers WHERE project_id = ?').get(project.id).cnt;
  if (vCount > 0) {
    req.flash('error', `Cannot delete: ${vCount} voucher(s) linked.`);
    return res.redirect(`/projects/${project.id}`);
  }
  if (project.representative_form) deleteFile(path.join('./public', project.representative_form));
  if (project.working_report_file) deleteFile(path.join('./public', project.working_report_file));
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  req.flash('success', 'Project deleted.');
  res.redirect('/projects');
};

// Add payment to a project
exports.addPayment = (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }

  const { transaction_date, payment_type, notes, amount } = req.body;
  const amt = parseFloat(amount) || 0;
  if (amt <= 0) { req.flash('error', 'Invalid amount.'); return res.redirect(`/projects/${project.id}`); }

  db.prepare('INSERT INTO project_payments (project_id, transaction_date, payment_type, notes, amount) VALUES (?,?,?,?,?)')
    .run(project.id, transaction_date, payment_type, notes, amt);

  const totalPaid = db.prepare('SELECT SUM(amount) as total FROM project_payments WHERE project_id = ?').get(project.id).total || 0;
  db.prepare('UPDATE projects SET payment_received = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totalPaid, project.id);

  if (totalPaid >= project.amount && project.amount > 0) {
    db.prepare("UPDATE projects SET status='Paid', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(project.id);
  }

  req.flash('success', 'Payment recorded.');
  res.redirect(`/projects/${project.id}`);
};

// Reps management
exports.repsIndex = (req, res) => {
  const reps = db.prepare('SELECT * FROM representatives ORDER BY name').all();
  res.render('projects/reps', { title: 'Representatives', reps, errors: [] });
};

exports.repCreate = (req, res) => {
  const { name, contact, email } = req.body;
  if (!name?.trim()) { req.flash('error', 'Name required.'); return res.redirect('/projects/representatives'); }
  db.prepare('INSERT INTO representatives (name, contact, email) VALUES (?,?,?)').run(name.trim(), contact || null, email || null);
  req.flash('success', 'Representative added.');
  res.redirect('/projects/representatives');
};

exports.repDestroy = (req, res) => {
  db.prepare('UPDATE representatives SET is_active=0 WHERE id=?').run(req.params.id);
  req.flash('success', 'Representative removed.');
  res.redirect('/projects/representatives');
};

// ---- Helpers ----
function sanitize(body) {
  const repId = body.representative_id ? parseInt(body.representative_id) : null;
  return {
    film_name: (body.film_name || '').trim(),
    production_company: (body.production_company || '').trim(),
    production_company_address: (body.production_company_address || '').trim() || null,
    language: body.language || null,
    production_contact_no: (body.production_contact_no || '').trim() || null,
    representative_id: !isNaN(repId) ? repId : null,
    place_of_dubbing: (body.place_of_dubbing || '').trim() || null,
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    company_email: (body.company_email || '').trim().toLowerCase() || null,
    amount: parseFloat(body.amount) || 0,
    payment_received: parseFloat(body.payment_received) || 0,
    invoice_no: (body.invoice_no || '').trim() || null,
    representative_form: null,
    working_report_file: null,
    status: body.status || 'Pending'
  };
}

function validate(data) {
  const errors = [];
  const warnings = [];

  // ✅ Required fields
  if (!data.film_name) errors.push('Film name is required.');
  if (!data.production_company) errors.push('Production company is required.');

  // ✅ CRITICAL: Check for zero amount
  if (data.amount === 0 || data.amount === '0' || data.amount === null || data.amount === undefined) {
    // Don't prevent creation, but add prominent warning
    warnings.push('⚠️ WARNING: Billing amount is ₹0. Make sure this is intentional. Non-billable projects should be marked as "TEST_" in the name.');
  }

  // ✅ Validate positive amount if provided
  if (data.amount < 0) {
    errors.push('Billing amount cannot be negative.');
  }

  return { errors, warnings };
}

function deleteFile(fp) { try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {} }
