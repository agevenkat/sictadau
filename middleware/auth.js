// Authentication middleware

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/auth/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/auth/login');
  }
  if (!['admin', 'superadmin'].includes(req.session.userRole)) {
    req.flash('error', 'Access denied. Admin privileges required.');
    return res.redirect('/dashboard');
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/auth/login');
  }
  if (req.session.userRole !== 'superadmin') {
    req.flash('error', 'Access denied.');
    return res.redirect('/dashboard');
  }
  next();
}

function redirectIfAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  next();
}

// Attach user to res.locals for all views
function attachUser(req, res, next) {
  res.locals.currentUser = (req.session && req.session.userId)
    ? {
        id: req.session.userId,
        name: req.session.userName || 'User',
        email: req.session.userEmail,
        role: req.session.userRole
      }
    : null;
  res.locals.flash_success = req.flash('success');
  res.locals.flash_error = req.flash('error');
  res.locals.flash_info = req.flash('info');
  next();
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, redirectIfAuth, attachUser };
