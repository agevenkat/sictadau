// Diagnostic: test /tmp filesystem and node:sqlite in Vercel environment
const express = require('express');
const app = express();
const fs = require('fs');

app.get('*', (req, res) => {
  const results = {};

  // Test 1: Can we write a regular file to /tmp?
  try {
    fs.writeFileSync('/tmp/test.txt', 'hello vercel');
    const content = fs.readFileSync('/tmp/test.txt', 'utf8');
    fs.unlinkSync('/tmp/test.txt');
    results.tmp_write = 'OK: ' + content;
  } catch (e) {
    results.tmp_write = 'FAIL: ' + e.message;
  }

  // Test 2: Can we create a node:sqlite database in /tmp?
  try {
    const { DatabaseSync } = require('node:sqlite');
    const testDb = new DatabaseSync('/tmp/test_diag.db');
    testDb.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER)');
    testDb.exec('INSERT INTO t VALUES (1)');
    const stmt = testDb.prepare('SELECT * FROM t');
    const rows = stmt.all();
    testDb.close();
    fs.unlinkSync('/tmp/test_diag.db');
    results.sqlite_file = 'OK: rows=' + rows.length;
  } catch (e) {
    results.sqlite_file = 'FAIL: ' + e.message + ' at ' + (e.stack||'').split('\n')[1];
  }

  // Test 3: Can we use in-memory sqlite?
  try {
    const { DatabaseSync } = require('node:sqlite');
    const memDb = new DatabaseSync(':memory:');
    memDb.exec('CREATE TABLE t (id INTEGER)');
    memDb.exec('INSERT INTO t VALUES (42)');
    const stmt = memDb.prepare('SELECT * FROM t');
    const rows = stmt.all();
    memDb.close();
    results.sqlite_memory = 'OK: rows=' + rows.length;
  } catch (e) {
    results.sqlite_memory = 'FAIL: ' + e.message;
  }

  // Test 4: /tmp directory listing
  try {
    const files = fs.readdirSync('/tmp');
    results.tmp_ls = files;
  } catch (e) {
    results.tmp_ls = 'FAIL: ' + e.message;
  }

  res.json({ node: process.version, vercel: process.env.VERCEL, ...results });
});

module.exports = app;
