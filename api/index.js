// Vercel serverless entry point — targeted diagnostic for db.js failure
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');

app.get('*', (req, res) => {
  const log = [];
  const out = (msg) => { log.push(msg); process.stdout.write(msg + '\n'); };

  try {
    out('VERCEL=' + process.env.VERCEL);
    out('DATABASE_PATH env=' + process.env.DATABASE_PATH);

    const tmpDb = '/tmp/sictadau_diag.db';
    // Clean up
    for (const f of [tmpDb, tmpDb+'-wal', tmpDb+'-shm', tmpDb+'-journal']) {
      try { if (fs.existsSync(f)) { fs.unlinkSync(f); out('Deleted: '+f); } } catch(e) { out('Del fail '+f+': '+e.message); }
    }

    out('tmp ls: ' + fs.readdirSync('/tmp').join(', '));

    const { DatabaseSync } = require('node:sqlite');
    out('DatabaseSync imported');

    const db = new DatabaseSync(tmpDb);
    out('DB opened');

    db.exec('PRAGMA foreign_keys = ON');
    out('PRAGMA foreign_keys OK');

    // Read and run the actual schema
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    out('schema path: ' + schemaPath + ' exists: ' + fs.existsSync(schemaPath));
    const schema = fs.readFileSync(schemaPath, 'utf8');
    out('schema length: ' + schema.length + ' chars');
    out('schema first 200: ' + schema.slice(0, 200).replace(/\n/g, '\\n'));

    // Split and run each statement
    const statements = schema.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
    out('statements count: ' + statements.length);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        db.exec(stmt + ';');
        out('stmt['+i+'] OK: ' + stmt.slice(0, 60).replace(/\n/g,' '));
      } catch(e) {
        out('stmt['+i+'] FAIL: ' + e.message + ' | SQL: ' + stmt.slice(0, 100));
        break;
      }
    }

    db.close();
    res.type('text').send(log.join('\n'));
  } catch(e) {
    log.push('CATCH: ' + e.message + '\n' + e.stack);
    res.status(500).type('text').send(log.join('\n'));
  }
});

module.exports = app;
