const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

let client;

if (process.env.TURSO_DATABASE_URL) {
  client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || '',
  });
  console.log('DB: Turso at', process.env.TURSO_DATABASE_URL);
} else {
  // On Vercel without Turso, fall back to /tmp (ephemeral but writable).
  // For local dev, use ./database/sictadau.db.
  const IS_VERCEL = process.env.VERCEL === '1';
  const dbPath = IS_VERCEL
    ? '/tmp/sictadau.db'
    : (process.env.DATABASE_PATH || path.join(__dirname, 'sictadau.db'));
  client = createClient({ url: `file:${dbPath}` });
  console.log('DB: local SQLite at', dbPath);
}

async function initDb() {
  // Strip SQL comments so we can classify statements reliably
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const stmts = schema
    .split(';')
    .map(s => s.replace(/--[^\n]*/g, '').trim())  // strip -- comments
    .filter(Boolean);

  const silentErr = (e) => {
    const m = String(e.message);
    if (!m.includes('already exists') && !m.includes('duplicate column name') && !m.includes('no such column')) {
      console.error('Schema stmt error:', m.slice(0, 120));
    }
  };
  const run = (stmt) => client.execute(stmt).catch(silentErr);

  // Phase 1 — CREATE TABLE (must exist before ALTER/INDEX/UPDATE)
  await Promise.all(stmts.filter(s => /^CREATE TABLE/i.test(s)).map(run));

  // Phase 2 — ALTER TABLE + data backfills (parallel, tables now exist)
  await Promise.all(stmts.filter(s => /^ALTER TABLE|^UPDATE /i.test(s)).map(run));

  // Phase 3 — CREATE INDEX (parallel, no ordering dependency)
  await Promise.all(stmts.filter(s => /^CREATE INDEX/i.test(s)).map(run));

  console.log('DB: schema ready');
}

const ready = initDb().catch(e => {
  console.error('DB init failed:', e.message);
  throw e;
});

function prepare(sql) {
  return {
    get: async (...params) => {
      const args = params.flat();
      const result = await client.execute({ sql, args });
      const row = result.rows[0];
      return row ? { ...row } : null;
    },
    all: async (...params) => {
      const args = params.flat();
      const result = await client.execute({ sql, args });
      return result.rows.map(row => ({ ...row }));
    },
    run: async (...params) => {
      const args = params.flat();
      const result = await client.execute({ sql, args });
      return {
        changes: result.rowsAffected,
        lastInsertRowid: Number(result.lastInsertRowid ?? 0)
      };
    }
  };
}

async function exec(sql) {
  const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    await client.execute(stmt);
  }
}

// Run multiple queries in a single Turso network round-trip.
// queries: array of { sql, args } or plain SQL strings (no args).
// Returns array of result sets; each has .rows (spread to plain objects) and .first().
async function batch(queries, mode = 'read') {
  const stmts = queries.map(q =>
    typeof q === 'string' ? { sql: q, args: [] } : { sql: q.sql, args: q.args ?? [] }
  );
  const results = await client.batch(stmts, mode);
  return results.map(r => ({
    rows: r.rows.map(row => ({ ...row })),
    first: () => r.rows[0] ? { ...r.rows[0] } : null
  }));
}

module.exports = { prepare, exec, batch, ready, client };
