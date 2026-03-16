function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  if (req.headers.accept?.includes('application/json') ||
      req.headers['content-type']?.includes('application/json')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  res.redirect('/admin/login');
}

module.exports = { requireAdmin };
