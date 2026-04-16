require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const flash = require('connect-flash');
const helmet = require('helmet');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Security headers ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'code.jquery.com', 'cdn.datatables.net', 'cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdn.datatables.net'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'cdn.jsdelivr.net'],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ---- View engine ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ---- Static files ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Body parsers ----
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// ---- Method override (PUT/DELETE via POST) ----
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));
app.use(methodOverride('_method'));

// ---- Session ----
const sessionDir = process.env.VERCEL === '1' ? '/tmp' : './database';
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: sessionDir }),
  secret: process.env.SESSION_SECRET || 'sictadau-fallback-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  name: 'sictadau.sid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// ---- Flash messages ----
app.use(flash());

// ---- CSRF protection ----
const csrfProtection = csrf();
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

// ---- Attach user to all views ----
const { attachUser } = require('./middleware/auth');
app.use(attachUser);

// ---- Routes ----
app.use('/auth', require('./routes/auth'));
app.get('/', (req, res) => res.redirect('/dashboard'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/members', require('./routes/members'));
app.use('/projects', require('./routes/projects'));
app.use('/vouchers', require('./routes/vouchers'));
app.use('/statements', require('./routes/statements'));
app.use('/users', require('./routes/users'));

// ---- CSRF error handler ----
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    req.flash('error', 'Invalid form submission. Please try again.');
    return res.redirect('back');
  }
  next(err);
});

// ---- 404 ----
app.use((req, res) => {
  res.status(404).render('404', { title: '404 — Not Found', activePage: '' });
});

// ---- Global error handler ----
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Error', error: process.env.NODE_ENV === 'development' ? err : {}, activePage: '' });
});

// ---- Seed first superadmin if no users exist ----
async function seedAdmin() {
  try {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    if (count === 0) {
      const hash = await bcrypt.hash('Admin@1234', 12);
      db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'superadmin')")
        .run('Administrator', 'admin@sictadau.org', hash);
      console.log('✅  Default admin created: admin@sictadau.org / Admin@1234');
    }
  } catch (e) {
    console.error('seedAdmin error:', e.message);
  }
}

// Run seed (non-blocking)
seedAdmin();

// ---- Local dev: start server; Vercel: export app ----
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀  SICTADAU running at http://localhost:${PORT}`);
  });
}

module.exports = app;
