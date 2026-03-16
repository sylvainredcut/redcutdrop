const express = require('express');
const { getAuthorizeUrl, exchangeCodeForTokens, hasRefreshToken } = require('../frameio');
const { verifyUser } = require('../db');
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

// User (monteur) login
router.post('/user/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  const user = verifyUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  req.session.user = user;
  res.json({ ok: true, user: { name: user.name, email: user.email } });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (req.session.admin) {
    return res.json({ admin: true });
  }
  if (req.session.user) {
    return res.json({ user: req.session.user });
  }
  res.status(401).json({ error: 'Non authentifie' });
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
