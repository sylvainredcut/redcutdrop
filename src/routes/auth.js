const express = require('express');
const { getAuthorizeUrl, exchangeCodeForTokens, hasRefreshToken } = require('../frameio');
const router = express.Router();

// Admin login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD non configure' });
  }

  if (password === expected) {
    req.session.admin = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ error: 'Mot de passe incorrect' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (req.session.admin) {
    res.json({ admin: true });
  } else {
    res.status(401).json({ error: 'Non authentifie' });
  }
});

// Adobe IMS OAuth - redirect to Adobe login
router.get('/adobe', (req, res) => {
  const url = getAuthorizeUrl();
  res.redirect(url);
});

// Adobe IMS OAuth - callback
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/admin?adobe_error=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect('/admin?adobe_error=no_code');
  }

  try {
    await exchangeCodeForTokens(code);
    res.redirect('/auth/success');
  } catch (err) {
    console.error('Adobe callback error:', err.response?.data || err.message);
    res.redirect('/admin?adobe_error=' + encodeURIComponent(err.message));
  }
});

// Token status
router.get('/status', (req, res) => {
  res.json({ connected: hasRefreshToken() });
});

module.exports = router;
