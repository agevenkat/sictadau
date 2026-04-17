// Vercel serverless entry point
// Minimal diagnostic: verify Vercel can run a function at all
const express = require('express');
const app = express();
app.get('*', (req, res) => {
  res.json({ status: 'ok', vercel: process.env.VERCEL, node: process.version });
});
module.exports = app;
