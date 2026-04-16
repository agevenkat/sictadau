const db = require('../database/db');
const path = require('path');
const fs = require('fs');
const pdf = require('html-pdf');

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
    const project = db.prepare(`SELECT p.*, r.name as rep_name FROM projects p
      LEFT JOIN representatives r ON p.representative_id = r.id WHERE p.id = ?`).get(req.params.id);
    if (!project) { req.flash('error', 'Project not found.'); return res.redirect('/projects'); }

    const vouchers = db.prepare(`SELECT v.*, m.full_name, m.membership_no FROM vouchers v
      JOIN members m ON v.member_id = m.id WHERE v.project_id = ? ORDER BY v.id`).all(project.id);

    const payments = db.prepare('SELECT * FROM project_payments WHERE project_id = ? ORDER BY transaction_date').all(project.id);
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

    // Generate HTML for PDF
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
          color: #000000;
          background: #fff;
          padding: 40px;
          line-height: 1.6;
        }
        .header {
          margin-bottom: 30px;
          display: flex;
          justify-content: space-between;
          border-bottom: 3px solid #303493;
          padding-bottom: 20px;
        }
        .header-left { flex: 1; }
        .header-right { text-align: right; }
        .header-item { font-size: 13px; margin-bottom: 8px; color: #000000; }
        .header-item strong { color: #000000; font-weight: 600; }
        .header-right .invoice-no { color: #303493; font-size: 18px; }
        .header-right .status { display: inline-block; padding: 4px 12px; border-radius: 4px; color: white; font-weight: 600; }
        .status.paid { background: #303493; }
        .status.pending { background: #EE3134; }

        .from-to { display: flex; justify-content: space-between; margin-bottom: 35px; gap: 40px; }
        .from-section, .to-section { flex: 1; }
        .section-label { font-size: 11px; font-weight: 700; margin-bottom: 12px; color: #303493; letter-spacing: 0.5px; text-transform: uppercase; }
        .section-content { font-size: 13px; line-height: 1.7; color: #000000; }
        .section-content strong { color: #000000; font-weight: 600; display: block; margin-bottom: 6px; }
        .section-content span { display: block; color: #000000; font-size: 12px; margin-bottom: 3px; }

        .summary {
          background: linear-gradient(135deg, #303493 0%, #1a1d5e 100%);
          padding: 28px;
          margin-bottom: 35px;
          border-radius: 8px;
          display: flex;
          justify-content: space-around;
          text-align: center;
        }
        .summary-item { flex: 1; }
        .summary-label { font-size: 10px; color: #ffffff; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .summary-value { font-size: 20px; font-weight: 700; color: #fff; }
        .summary-item:nth-child(2), .summary-item:nth-child(4) { border-left: 2px solid rgba(255,255,255,0.2); border-right: 2px solid rgba(255,255,255,0.2); padding: 0 30px; }
        .summary-balance-negative { color: #EE3134; }

        .section-title {
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 15px;
          color: #303493;
          padding-bottom: 10px;
          border-bottom: 2px solid #303493;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin-bottom: 20px;
        }
        thead tr { background: #303493; color: white; }
        th {
          padding: 12px;
          text-align: left;
          font-weight: 700;
          border: none;
        }
        td {
          padding: 12px;
          border: none;
          border-bottom: 1px solid #e0e0e0;
          color: #000000;
        }
        tbody tr:nth-child(odd) { background: #f9f9f9; }
        tbody tr:nth-child(even) { background: #fff; }
        td strong { color: #000000; }
        .total-cell { text-align: right; color: #303493; font-weight: 700; }
        .total-row {
          text-align: right;
          margin-top: 15px;
          padding-top: 15px;
          border-top: 2px solid #303493;
          font-size: 13px;
        }
        .total-row strong { color: #000000; }
        .total-amount {
          display: inline-block;
          width: 200px;
          text-align: right;
          color: #303493;
          font-weight: 700;
          font-size: 15px;
        }

        .bank-details {
          margin-bottom: 35px;
          padding: 18px;
          background: #f5f7ff;
          border-left: 4px solid #303493;
          border-radius: 4px;
          font-size: 12px;
        }
        .bank-details div { margin-bottom: 6px; color: #000000; }
        .bank-details div:last-child { margin-bottom: 0; }
        .bank-details strong { font-weight: 600; }

        .payment-history-total {
          background: #303493;
          color: white;
          font-weight: 700;
        }
        .payment-history-total td { color: white; border: none; }

        .divider { border-top: 2px solid #303493; margin-bottom: 30px; padding-top: 30px; }

        .signature {
          display: flex;
          justify-content: space-around;
          margin-bottom: 20px;
          font-size: 12px;
          text-align: center;
        }
        .sig-space { height: 45px; margin-bottom: 12px; }
        .sig-line { border-top: 2px solid #000000; padding-top: 8px; color: #000000; font-weight: 600; }

        .footer { font-size: 11px; color: #999; text-align: center; margin-top: 20px; font-style: italic; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          <div class="header-item">Project Entry Date : <strong>${project.start_date}</strong></div>
          <div class="header-item">Project End Date : <strong>${project.end_date}</strong></div>
        </div>
        <div class="header-right">
          <div class="header-item">Invoice No. : <strong class="invoice-no">${project.id}</strong></div>
          <div class="header-item">Status : <strong><span class="status ${project.status === 'Paid' ? 'paid' : 'pending'}">${project.status}</span></strong></div>
        </div>
      </div>

      <div class="from-to">
        <div class="from-section">
          <div class="section-label">From:</div>
          <div class="section-content">
            <strong>South Indian Cine, Television Artistes and Dubbing Artistes Union</strong>
            <span>ESTD : 1983 - Regd No. 1337/MDS</span>
            <span>Affiliated with FEFSI</span>
            <span>10, Vijayaraghavapuram 4th Street, Saligamam, Chennai-600093</span>
            <span>044-23650223, 23650225, 23650229</span>
            <span style="color: #303493; font-weight: 500;">sictadau@gmail.com</span>
          </div>
        </div>
        <div class="to-section">
          <div class="section-label">To:</div>
          <div class="section-content">
            <strong>${project.production_company}</strong>
            <span>Project Name : <strong>${project.film_name}</strong></span>
            <span>Project Language : <strong>${project.language || '—'}</strong></span>
            <span>POD : <strong>${project.place_of_dubbing || '—'}</strong></span>
            <span>Contact : ${project.production_contact_no || '—'}</span>
            <span>Representative: <strong>${project.rep_name || '—'}</strong></span>
          </div>
        </div>
      </div>

      <div class="summary">
        <div class="summary-item">
          <div class="summary-label">TOTAL AMOUNT</div>
          <div class="summary-value">₹${(project.amount||0).toLocaleString('en-IN')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">AMOUNT RECEIVED</div>
          <div class="summary-value">₹${(project.payment_received||0).toLocaleString('en-IN')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">BALANCE</div>
          <div class="summary-value ${((project.amount||0) - (project.payment_received||0)) > 0 ? 'summary-balance-negative' : ''}">₹${((project.amount||0) - (project.payment_received||0)).toLocaleString('en-IN')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">TOTAL ARTISTS</div>
          <div class="summary-value">${vouchers.length}</div>
        </div>
      </div>

      <div style="margin-bottom: 35px;">
        <div class="section-title">Artist Vouchers (${vouchers.length})</div>
        ${vouchers.length === 0 ?
          '<div style="padding: 30px; text-align: center; color: #999; font-size: 13px;">No vouchers added yet</div>' :
          `<table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Mem No.</th>
                <th>Dubbing Artist Name</th>
                <th>Character</th>
                <th style="text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${vouchers.map(v => `
              <tr>
                <td>${v.id}</td>
                <td>${v.membership_no}</td>
                <td><strong>${v.full_name}</strong></td>
                <td>${v.character || '—'}</td>
                <td class="total-cell">Rs. ${(v.amount||0).toLocaleString('en-IN')}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="total-row">
            <div style="font-size: 13px;">
              <strong>Total</strong>
              <span class="total-amount">Rs. ${vouchers.reduce((s,v)=>s+(v.amount||0),0).toLocaleString('en-IN')}</span>
            </div>
          </div>`
        }
      </div>

      <div class="bank-details">
        <div><strong>A/C Name :</strong> South Indian Cine, Television Artistes and Dubbing Artistes Union</div>
        <div><strong>A/C NO. :</strong> 1616135000004793</div>
        <div><strong>IFSC CODE :</strong> KVBL0001616</div>
        <div><strong>BANK :</strong> KARUR VYSYA BANK, K.K.Nagar Branch</div>
        <div><strong>PAN NO. :</strong> AADAS9061M</div>
      </div>

      ${payments.length > 0 ? `
      <div style="margin-bottom: 35px;">
        <div class="section-title">Payment History</div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th style="width: 15%;">Transaction Date</th>
              <th>Payment Type</th>
              <th>Notes</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
            <tr>
              <td>${p.id}</td>
              <td>${p.transaction_date}</td>
              <td><strong>${p.payment_type}</strong></td>
              <td>${p.notes || '—'}</td>
              <td class="total-cell">Rs. ${p.amount.toLocaleString('en-IN')}</td>
            </tr>
            `).join('')}
            <tr class="payment-history-total">
              <td colspan="4" style="text-align: right;">Total Amount Received</td>
              <td style="text-align: right;">Rs. ${totalPaid.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ` : ''}

      <div class="divider"></div>

      <div class="signature">
        <div>
          <div class="sig-space"></div>
          <div class="sig-line">Co-ordinator<br>Mr.C.D.Ananthraman</div>
        </div>
        <div>
          <div class="sig-space"></div>
          <div class="sig-line">Manager / Secretary<br>Treasurer</div>
        </div>
        <div>
          <div class="sig-space"></div>
          <div class="sig-line">For ${project.production_company}</div>
        </div>
      </div>
      <div class="footer">*Cheque subject to realisation</div>
    </body>
    </html>
    `;

    // PDF options
    const options = {
      format: 'A4',
      margin: '10mm',
      footer: { height: '10mm' }
    };

    // Generate PDF
    pdf.create(htmlContent, options).toBuffer((err, buffer) => {
      if (err) {
        console.error('PDF generation error:', err);
        req.flash('error', 'Failed to generate PDF.');
        return res.redirect(`/projects/${project.id}`);
      }

      // Send PDF to browser
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Invoice-${project.id}-${project.film_name}.pdf"`);
      res.send(buffer);
    });
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
