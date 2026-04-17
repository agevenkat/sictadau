// Vercel serverless entry point — loads app.js with error surfacing
process.stdout.write('[api/index] loading app.js\n');

let app;
try {
  app = require('../app');
  process.stdout.write('[api/index] app.js loaded OK\n');
} catch (err) {
  process.stdout.write('[api/index] LOAD ERROR: ' + err.message + '\n' + err.stack + '\n');
  // Return a minimal app that surfaces the startup error
  const express = require('express');
  const errApp = express();
  errApp.get('*', (req, res) => {
    res.status(500).type('text').send('STARTUP ERROR:\n' + err.message + '\n\n' + err.stack);
  });
  app = errApp;
}

module.exports = app;
