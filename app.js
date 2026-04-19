require('dotenv').config();

// Catch any unhandled startup errors and log them clearly
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
});

let db;
try {
  db = require('./database/db');
  console.log('DB loaded OK');
} catch (e) {
  console.error('FATAL: DB load failed:', e.message, e.stack);
  throw e;
}

const express = require('express');
const path = require('path');
const session = require('express-session');

const cookieParser = require('cookie-parser');
const flash = require('connect-flash');
const helmet = require('helmet');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const csrf = require('csurf');
const bcrypt = require('bcryptjs');
const IS_VERCEL = process.env.VERCEL === '1';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Vercel's reverse proxy so req.protocol === 'https' inside Lambdas
// (required for cookie-session / cookies library to set Secure cookies)
if (IS_VERCEL) app.set('trust proxy', 1);

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
// Skip express-ejs-layouts for auth routes — login.ejs is a self-contained HTML page
app.use((req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  expressLayouts(req, res, next);
});
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ---- Static files ----
// On Vercel, /public/uploads is read-only; uploaded files are stored in /tmp/uploads
// and served here before the static middleware picks up anything else under /uploads.
if (IS_VERCEL) {
  const fsSync = require('fs');
  app.use('/uploads', (req, res) => {
    const filePath = path.join('/tmp/uploads', path.basename(req.path));
    if (fsSync.existsSync(filePath)) return res.sendFile(filePath);
    res.status(404).end();
  });
}
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

// ---- Cookie parser (required for cookie-based CSRF) ----
app.use(cookieParser());

// ---- Cache-Control: no-store for all dynamic responses ----
// Prevents Vercel CDN from caching responses and stripping Set-Cookie headers
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---- Session ----
// On Vercel (serverless) use cookie-session: stores all data in a signed cookie,
// so sessions survive across Lambda cold starts with no server-side store.
// Locally use express-session + SQLite store for persistence across restarts.
if (IS_VERCEL) {
  const cookieSession = require('cookie-session');
  app.use(cookieSession({
    name: 'sictadau.sid',
    secret: process.env.SESSION_SECRET || 'sictadau-fallback-secret-change-in-prod',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    httpOnly: true,
    secure: true,
    sameSite: 'lax'
  }));
  // connect-flash expects req.session.save to exist
  app.use((req, res, next) => {
    if (req.session && !req.session.save) {
      req.session.save = (cb) => { if (cb) cb(); };
    }
    next();
  });
} else {
  let sessionStore;
  try {
    const SQLiteStore = require('connect-sqlite3')(session);
    sessionStore = new SQLiteStore({ db: 'sessions.db', dir: './database' });
  } catch (e) {
    console.warn('connect-sqlite3 unavailable, using MemoryStore:', e.message);
  }
  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'sictadau-fallback-secret-change-in-prod',
    resave: false,
    saveUninitialized: true,
    name: 'sictadau.sid',
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));
}

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

// ---- Medium gate: authenticated users must pick Film/TV before accessing app ----
app.use((req, res, next) => {
  if (!req.session?.userId) return next();          // not logged in
  if (req.path.startsWith('/auth')) return next();  // auth pages
  if (req.session.activeMedium) return next();      // medium already set
  if (req.method === 'GET' && req.accepts('html')) return res.redirect('/auth/select-medium');
  next();
});

// ---- Ready-gate: block requests until DB is initialised + admin seeded ----
// appReady is set below after seedAdmin() is defined; Promise is already settled
// on warm Lambdas so this adds zero latency on all but the very first cold start.
app.use(async (req, res, next) => {
  try { await global._appReady; next(); } catch (e) { next(e); }
});

// ---- Routes ----
app.use('/auth', require('./routes/auth'));
app.get('/', (req, res) => res.redirect('/dashboard'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/members', require('./routes/members'));
app.use('/projects', require('./routes/projects'));
app.use('/vouchers', require('./routes/vouchers'));
app.use('/statements', require('./routes/statements'));
app.use('/rep-payments', require('./routes/repPayments'));
app.use('/reports', require('./routes/reports'));
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
    await db.ready;
    const row = await db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    if (row.cnt === 0) {
      const hash = await bcrypt.hash('Admin@1234', 12);
      await db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'superadmin')")
        .run('Administrator', 'admin@sictadau.org', hash);
      console.log('✅  Default admin created: admin@sictadau.org / Admin@1234');
    }
  } catch (e) {
    console.error('seedAdmin error:', e.message);
  }
}

// Store seed promise in global so the ready-gate middleware (registered above) can await it
global._appReady = seedAdmin();

// ---- Local dev: start server; Vercel: export app ----
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀  SICTADAU running at http://localhost:${PORT}`);
  });
}

module.exports = app;
