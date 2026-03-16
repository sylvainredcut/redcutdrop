function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  if (req.headers.accept?.includes('application/json') ||
      req.headers['content-type']?.includes('application/json') ||
      req.xhr) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  res.redirect('/admin/login');
}

function requireUser(req, res, next) {
  if (req.session && (req.session.user || req.session.admin)) {
    return next();
  }
  if (req.headers.accept?.includes('application/json') ||
      req.headers['content-type']?.includes('application/json') ||
      req.xhr) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  res.redirect('/login');
}

module.exports = { requireAdmin, requireUser };
