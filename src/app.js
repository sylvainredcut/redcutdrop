require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const uploadRoutes = require('./routes/upload');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { requireAdmin, requireUser } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Ensure dirs exist
const uploadsDir = path.join(__dirname, '..', 'uploads');
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'redcut-drop-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' ? true : false,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  },
  proxy: true
}));

// Static assets (CSS, JS, images) — public
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes (login pages, Adobe OAuth) — public with rate limiting
app.use('/auth/login', authLimiter);
app.use('/auth/user/login', authLimiter);
app.use('/auth', authRoutes);

// Upload API — requires authenticated user
app.use('/api', requireUser, uploadRoutes);

// Admin API — requires admin
app.use('/api/admin', requireAdmin, adminRoutes);

// Pages
app.get('/login', (req, res) => {
  if (req.session.user || req.session.admin) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login-user.html'));
});

app.get('/', (req, res) => {
  if (!req.session.user && !req.session.admin) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/auth/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth-success.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Upload Redcut running on http://localhost:${PORT}`);
});
