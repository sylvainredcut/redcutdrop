require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
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
const storageDir = path.join(__dirname, '..', 'storage', 'temp');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(storageDir, { recursive: true });

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

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

// Serve temporary storage files (for N8N/Metricool downloads)
// These are public URLs — files are cleaned up after 14 days
app.use('/storage/temp', express.static(storageDir, {
  maxAge: '1h',
  setHeaders: (res, filepath) => {
    // Force download with original filename
    res.set('Content-Disposition', 'inline');
  }
}));

// Auth routes (login pages, Adobe OAuth) — public with rate limiting
app.use('/auth', authRoutes);

// Admin API — requires admin (must be before /api to avoid requireUser intercepting)
app.use('/api/admin', requireAdmin, adminRoutes);

// Upload API — requires authenticated user
app.use('/api', requireUser, uploadRoutes);

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

// ---- Cleanup cron: delete temp storage files older than 14 days ----
function cleanupTempStorage() {
  const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
  const now = Date.now();
  try {
    const entries = fs.readdirSync(storageDir);
    for (const entry of entries) {
      const fullPath = path.join(storageDir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Each upload gets its own subdirectory
        const files = fs.readdirSync(fullPath);
        const dirStat = fs.statSync(fullPath);
        if (now - dirStat.mtimeMs > MAX_AGE_MS) {
          for (const f of files) {
            fs.unlinkSync(path.join(fullPath, f));
          }
          fs.rmdirSync(fullPath);
          console.log(`Cleanup: removed ${entry}`);
        }
      } else if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(fullPath);
        console.log(`Cleanup: removed ${entry}`);
      }
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}

// Run cleanup every 6 hours
setInterval(cleanupTempStorage, 6 * 60 * 60 * 1000);
// Run once at startup
cleanupTempStorage();

app.listen(PORT, () => {
  console.log(`Upload Redcut running on http://localhost:${PORT}`);
});
