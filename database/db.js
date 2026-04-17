const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// On Vercel (serverless), only /tmp is writable.
// Copy the bundled DB to /tmp on first run, or create fresh if not found.
function resolveDbPath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;

  const isVercel = process.env.VERCEL === '1';
  if (isVercel) {
    const tmpDb = '/tmp/sictadau.db';
    if (!fs.existsSync(tmpDb)) {
      // Try to copy from bundled location
      const candidates = [
        path.join(__dirname, 'sictadau.db'),
        path.join(process.cwd(), 'database', 'sictadau.db'),
        '/var/task/database/sictadau.db'
      ];
      let copied = false;
      for (const srcDb of candidates) {
        try {
          if (fs.existsSync(srcDb)) {
            fs.copyFileSync(srcDb, tmpDb);
            console.log('DB copied from', srcDb, 'to', tmpDb);
            copied = true;
            break;
          }
        } catch (e) {
          console.warn('Copy attempt failed from', srcDb, ':', e.message);
        }
      }
      if (!copied) {
        console.log('No source DB found — starting with fresh database at', tmpDb);
      }
    }
    return tmpDb;
  }

  return path.join(__dirname, 'sictadau.db');
}

const DB_PATH = resolveDbPath();
const dbDir = path.dirname(DB_PATH);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Performance pragmas
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Run schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Wrap db to match better-sqlite3 API used throughout the app
// node:sqlite uses different method names, so we add a compatibility layer

const originalPrepare = db.prepare.bind(db);

db.prepare = function(sql) {
  const stmt = originalPrepare(sql);

  return {
    get: (...params) => {
      try {
        return stmt.get(...params) || null;
      } catch (err) {
        console.error('DB.get error:', err.message, 'SQL:', sql);
        throw err;
      }
    },
    all: (...params) => {
      try {
        return stmt.all(...params) || [];
      } catch (err) {
        console.error('DB.all error:', err.message, 'SQL:', sql);
        throw err;
      }
    },
    run: (...params) => {
      try {
        const result = stmt.run(...params);
        // Ensure lastInsertRowid property exists for INSERT operations
        return {
          changes: result.changes || 0,
          lastInsertRowid: result.lastInsertRowid || 0,
          ...result
        };
      } catch (err) {
        console.error('DB.run error:', err.message, 'SQL:', sql);
        throw err;
      }
    },
  };
};

module.exports = db;
