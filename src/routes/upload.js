const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { uploadFile, uploadFileToFolder, createShareLink, listClients, listProjectFolders, findOrCreateNestedFolder, getAssetDownloadUrl } = require('../frameio');
const { recordUpload, getUserClients } = require('../db');
const { sendDiscordNotification } = require('../discord');

const router = express.Router();

const STORAGE_DIR = path.join(__dirname, '..', '..', 'storage', 'temp');

// ---- Multer for revision mode (temp uploads dir, cleaned after Frame.io upload) ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const safeName = file.originalname.normalize('NFC');
    cb(null, `${unique}-${safeName}`);
  }
});

// ---- Multer for publish mode (storage/temp, kept for 14 days) ----
const publishStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Only create a unique subdirectory for the video file, not transcription
    if (file.fieldname === 'video') {
      const uid = crypto.randomBytes(8).toString('hex');
      const dir = path.join(STORAGE_DIR, uid);
      fs.mkdirSync(dir, { recursive: true });
      req._storageUid = uid;
      cb(null, dir);
    } else {
      // Transcription goes to /app/uploads (temporary, deleted after read)
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    }
  },
  filename: (req, file, cb) => {
    // Keep original filename (NFC normalized)
    cb(null, file.originalname.normalize('NFC'));
  }
});

const videoFilter = (req, file, cb) => {
  const allowed = /\.(mp4|mov|avi|mxf|mts|m2ts|mkv|wmv|flv|webm|prores|r3d|braw|mpg|mpeg|m4v|3gp|ts)$/i;
  if (allowed.test(file.originalname) || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers video sont acceptes'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 * 1024 },
  fileFilter: videoFilter
});

const publishUpload = multer({
  storage: publishStorage,
  limits: { fileSize: 15 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accept video files OR text files (for transcription)
    if (file.fieldname === 'transcription') {
      const allowed = /\.(txt|srt|vtt|doc|docx|rtf)$/i;
      if (allowed.test(file.originalname) || file.mimetype.startsWith('text/')) {
        cb(null, true);
      } else {
        cb(new Error('Seuls les fichiers texte sont acceptes pour la transcription'));
      }
    } else {
      videoFilter(req, file, cb);
    }
  }
});

// ---- Clients = Frame.io projects (filtered by user access) ----
router.get('/clients', async (req, res) => {
  try {
    const allClients = await listClients();

    if (req.session?.admin) {
      return res.json(allClients);
    }

    if (req.session?.user?.id) {
      const allowed = getUserClients(req.session.user.id);
      if (allowed.length === 0) {
        return res.json([]);
      }
      const allowedIds = new Set(allowed.map(a => a.client_project_id));
      return res.json(allClients.filter(c => allowedIds.has(c.id)));
    }

    res.json([]);
  } catch (err) {
    console.error('Clients error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Impossible de charger les clients depuis Frame.io' });
  }
});

// ---- Brands from Baserow (for publish mode) ----
router.get('/brands', async (req, res) => {
  try {
    const baserowUrl = 'https://baserow.redcut.fr/api/database/rows/table/764/?user_field_names=true';
    const baserowToken = 'KF8et9qGHYfFpGUbBJhU5iFOrLAdAVgm';

    const response = await axios.get(baserowUrl, {
      headers: { Authorization: `Token ${baserowToken}` }
    });

    const rows = response.data.results || [];
    const brands = rows
      .map(r => ({ name: r['Nom Marque'] || r['Nom marque'] || '' }))
      .filter(b => b.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    res.json(brands);
  } catch (err) {
    console.error('Baserow brands error:', err.response?.data || err.message);
    // Fallback static list
    res.json([
      { name: 'Anavi' },
      { name: 'Redcut' },
      { name: 'Tsvetkov' }
    ]);
  }
});

// ---- List folders for a project ----
router.get('/clients/:projectId/folders', async (req, res) => {
  try {
    const folders = await listProjectFolders(req.params.projectId);
    res.json(folders);
  } catch (err) {
    console.error('Folders error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Impossible de charger les dossiers' });
  }
});

// ---- Upload endpoint (Revision mode) — up to 3 files ----
// Uses NDJSON streaming to send heartbeats during Frame.io upload (prevents browser timeout)
router.post('/upload', upload.array('videos', 3), async (req, res) => {
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Aucun fichier envoye' });
  }

  const { projectId, clientName, week, comment } = req.body;

  if (!projectId || !clientName || !week) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    return res.status(400).json({ error: 'Client et semaine requis' });
  }

  // Switch to NDJSON streaming to keep connection alive during Frame.io upload
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.flushHeaders();

  // Send heartbeat every 10s to prevent proxy/browser timeout
  const heartbeat = setInterval(() => {
    try { res.write(JSON.stringify({ type: 'heartbeat' }) + '\n'); } catch {}
  }, 10000);

  const results = [];
  const assetIds = [];

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      res.write(JSON.stringify({ type: 'progress', step: 'frameio', file: i + 1, total: files.length, name: file.originalname }) + '\n');

      const result = await uploadFile(
        file.path,
        file.originalname.normalize('NFC'),
        file.size,
        file.mimetype,
        projectId,
        week
      );

      fs.unlinkSync(file.path);
      results.push(result);
      assetIds.push(result.id);

      recordUpload({
        filename: file.originalname.normalize('NFC'),
        client: clientName,
        week,
        filesize: file.size,
        frameio_asset_id: result.id,
        frameio_link: result.view_url || '',
        uploaded_by: req.session?.user?.name || (req.session?.admin ? 'admin' : null)
      });
    }

    let shareLink = results[0].view_url;
    try {
      shareLink = await createShareLink(results[0].project_id, assetIds, `${clientName} ${week}`);
    } catch (err) {
      console.error('Share link error:', err.response?.data || err.message);
    }

    sendDiscordNotification({
      filename: results.map(r => r.name).join(', '),
      client: clientName,
      week,
      filesize: files.reduce((sum, f) => sum + f.size, 0),
      link: shareLink,
      comment: comment || '',
      mode: 'revision'
    });

    clearInterval(heartbeat);
    res.write(JSON.stringify({ type: 'done', ok: true, assets: results, shareLink }) + '\n');
    res.end();
  } catch (err) {
    clearInterval(heartbeat);
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    console.error('Upload error:', err.response?.data || err.message);
    res.write(JSON.stringify({ type: 'done', ok: false, error: err.response?.data?.message || err.message || 'Upload echoue' }) + '\n');
    res.end();
  }
});

// ---- Publish endpoint (Mise en ligne mode) — 1 video + optional transcription ----
router.post('/publish', publishUpload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'transcription', maxCount: 1 }
]), async (req, res) => {
  const file = req.files?.video?.[0];

  if (!file) {
    return res.status(400).json({ error: 'Aucun fichier envoye' });
  }

  const { brandName, projectId, week, comment } = req.body;

  if (!brandName || !week) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(400).json({ error: 'Marque et semaine requises' });
  }

  const storageUid = req._storageUid;
  const originalName = file.originalname.normalize('NFC');
  const appUrl = process.env.APP_URL || 'https://upload.redcut.fr';
  const videoUrl = `${appUrl}/storage/temp/${storageUid}/${encodeURIComponent(originalName)}`;

  // Read transcription file content if provided, then delete it
  let transcriptionText = '';
  const transcriptionFile = req.files?.transcription?.[0];
  if (transcriptionFile) {
    try {
      transcriptionText = fs.readFileSync(transcriptionFile.path, 'utf-8').trim();
    } catch (err) {
      console.error('Transcription read error:', err.message);
    }
    try { fs.unlinkSync(transcriptionFile.path); } catch {}
  }

  // Switch to NDJSON streaming to keep connection alive during Frame.io upload
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try { res.write(JSON.stringify({ type: 'heartbeat' }) + '\n'); } catch {}
  }, 10000);

  try {
    // Upload to Frame.io for archiving: Client > Archivage > SXX
    let frameioAssetId = null;
    let shareLink = null;

    if (projectId) {
      res.write(JSON.stringify({ type: 'progress', step: 'frameio', name: originalName }) + '\n');

      // Create Archivage/SXX folder structure
      const archiveFolderId = await findOrCreateNestedFolder(projectId, ['Archivage', week]);

      const result = await uploadFileToFolder(
        file.path,
        originalName,
        file.size,
        file.mimetype,
        archiveFolderId
      );
      frameioAssetId = result.id;

      try {
        shareLink = await createShareLink(projectId, [result.id], `${brandName} ${week}`);
      } catch (err) {
        console.error('Share link error:', err.response?.data || err.message);
      }

      recordUpload({
        filename: originalName,
        client: brandName,
        week: week,
        filesize: file.size,
        frameio_asset_id: result.id,
        frameio_link: result.view_url || '',
        uploaded_by: req.session?.user?.name || (req.session?.admin ? 'admin' : null)
      });
    }

    res.write(JSON.stringify({ type: 'progress', step: 'webhook' }) + '\n');

    // Send webhook to N8N — always use local storage URL (file stays 48h)
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://n8n.srv1050420.hstgr.cloud/webhook/frameio-approval';
    const webhookPayload = {
      trigger: 'ready_for_publication',
      video: {
        name: originalName,
        url: videoUrl,
        file_size: file.size,
        media_type: file.mimetype
      },
      project: {
        name: brandName
      },
      publication_week: week,
      transcription: transcriptionText || null,
      frame_io_asset_id: frameioAssetId,
      uploaded_by: req.session?.user?.name || (req.session?.admin ? 'admin' : null),
      timestamp: new Date().toISOString()
    };

    try {
      await axios.post(n8nWebhookUrl, webhookPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      console.log('N8N webhook sent:', originalName, brandName, week);
    } catch (err) {
      console.error('N8N webhook error:', err.message);
    }

    // Discord notification
    sendDiscordNotification({
      filename: originalName,
      client: brandName,
      week,
      filesize: file.size,
      link: shareLink || videoUrl,
      comment: comment || '',
      mode: 'publish'
    });

    clearInterval(heartbeat);
    res.write(JSON.stringify({
      type: 'done', ok: true,
      asset: { id: frameioAssetId, name: originalName, videoUrl },
      shareLink
    }) + '\n');
    res.end();
  } catch (err) {
    clearInterval(heartbeat);
    // Don't delete the file from storage on error — keep it for retry
    console.error('Publish error:', err.response?.data || err.message);
    res.write(JSON.stringify({ type: 'done', ok: false, error: err.response?.data?.message || err.message || 'Publication echouee' }) + '\n');
    res.end();
  }
});

module.exports = router;
