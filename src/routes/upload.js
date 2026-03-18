const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { uploadFile, createShareLink, listClients, listProjectFolders } = require('../frameio');
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
    // Create a unique subdirectory per upload
    const uid = crypto.randomBytes(8).toString('hex');
    const dir = path.join(STORAGE_DIR, uid);
    fs.mkdirSync(dir, { recursive: true });
    req._storageUid = uid;
    cb(null, dir);
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
  fileFilter: videoFilter
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

  const results = [];
  const assetIds = [];

  try {
    for (const file of files) {
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
      shareLink = await createShareLink(results[0].project_id, assetIds);
    } catch (err) {
      console.error('Share link error:', err.response?.data || err.message);
    }

    sendDiscordNotification({
      filename: results.map(r => r.name).join(', '),
      client: clientName,
      week,
      filesize: files.reduce((sum, f) => sum + f.size, 0),
      link: shareLink,
      comment: comment || ''
    });

    res.json({
      ok: true,
      assets: results,
      shareLink
    });
  } catch (err) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    console.error('Upload error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || err.message || 'Upload echoue'
    });
  }
});

// ---- Publish endpoint (Mise en ligne mode) — 1 file ----
router.post('/publish', publishUpload.single('video'), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Aucun fichier envoye' });
  }

  const { brandName, projectId, comment } = req.body;

  if (!brandName) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(400).json({ error: 'Marque requise' });
  }

  const storageUid = req._storageUid;
  const originalName = file.originalname.normalize('NFC');
  const appUrl = process.env.APP_URL || 'https://upload.redcut.fr';
  const videoUrl = `${appUrl}/storage/temp/${storageUid}/${encodeURIComponent(originalName)}`;

  try {
    // Upload to Frame.io for archiving (use "Mise en ligne" as folder)
    let frameioAssetId = null;
    let shareLink = null;

    if (projectId) {
      const result = await uploadFile(
        file.path,
        originalName,
        file.size,
        file.mimetype,
        projectId,
        'Mise en ligne'
      );
      frameioAssetId = result.id;

      try {
        shareLink = await createShareLink(result.project_id, [result.id]);
      } catch (err) {
        console.error('Share link error:', err.response?.data || err.message);
      }

      recordUpload({
        filename: originalName,
        client: brandName,
        week: 'Mise en ligne',
        filesize: file.size,
        frameio_asset_id: result.id,
        frameio_link: result.view_url || '',
        uploaded_by: req.session?.user?.name || (req.session?.admin ? 'admin' : null)
      });
    }

    // Send webhook to N8N
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
      frame_io_asset_id: frameioAssetId,
      uploaded_by: req.session?.user?.name || (req.session?.admin ? 'admin' : null),
      timestamp: new Date().toISOString()
    };

    try {
      await axios.post(n8nWebhookUrl, webhookPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      console.log('N8N webhook sent:', originalName, brandName);
    } catch (err) {
      console.error('N8N webhook error:', err.message);
      // Don't fail the upload if webhook fails
    }

    // Discord notification
    sendDiscordNotification({
      filename: originalName,
      client: brandName,
      week: 'Mise en ligne',
      filesize: file.size,
      link: shareLink || videoUrl,
      comment: comment || ''
    });

    res.json({
      ok: true,
      asset: {
        id: frameioAssetId,
        name: originalName,
        videoUrl
      },
      shareLink
    });
  } catch (err) {
    // Don't delete the file from storage on error — keep it for retry
    console.error('Publish error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || err.message || 'Publication echouee'
    });
  }
});

module.exports = router;
