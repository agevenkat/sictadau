// Vercel serverless entry point — re-exports the main Express app
process.stdout.write('[api/index] loading app.js\n');

let app;
try {
  app = require('../app');
  process.stdout.write('[api/index] app.js loaded OK\n');
} catch (err) {
  process.stdout.write('[api/index] LOAD ERROR: ' + err.message + '\n' + err.stack + '\n');
  const express = require('express');
  const errApp = express();
  errApp.get('*', (req, res) => {
    res.status(500).type('text').send('STARTUP ERROR:\n' + err.message + '\n\n' + err.stack);
  });
  app = errApp;
}

module.exports = app;
