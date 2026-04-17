const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// On Vercel (serverless), only /tmp is writable.
// Always use a fresh DB at /tmp — schema + seed runs on every cold start.
const IS_VERCEL = process.env.VERCEL === '1';

function resolveDbPath() {
  if (IS_VERCEL) {
    // On Vercel only /tmp is writable — ignore relative DATABASE_PATH env vars.
    // Accept DATABASE_PATH only if it explicitly starts with /tmp/.
    const envPath = process.env.DATABASE_PATH;
    const tmpDb = (envPath && envPath.startsWith('/tmp/')) ? envPath : '/tmp/sictadau.db';
    // Remove any stale/corrupt files from a previous run (including WAL/SHM)
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm', tmpDb + '-journal']) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
    console.log('Vercel: using fresh DB at', tmpDb);
    return tmpDb;
  }

  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  return path.join(__dirname, 'sictadau.db');
}

const DB_PATH = resolveDbPath();
const dbDir = path.dirname(DB_PATH);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log('Opening SQLite at:', DB_PATH);
const db = new DatabaseSync(DB_PATH);
console.log('SQLite opened OK');

// Vercel Lambda may not support WAL mode (requires shared memory file locking).
// Use DELETE journal mode instead — simpler, works everywhere.
if (!IS_VERCEL) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
}
db.exec('PRAGMA foreign_keys = ON');

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
