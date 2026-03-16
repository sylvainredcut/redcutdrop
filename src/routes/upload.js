const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadFile, createShareLink, listClients, listProjectFolders } = require('../frameio');
const { recordUpload } = require('../db');
const { sendDiscordNotification } = require('../discord');

const router = express.Router();

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

const upload = multer({
  storage,
  limits: { fileSize: Infinity },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp4|mov|avi|mxf|mts|m2ts|mkv|wmv|flv|webm|prores|r3d|braw)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers video sont acceptes'));
    }
  }
});

// Clients = Frame.io projects
router.get('/clients', async (req, res) => {
  try {
    const clients = await listClients();
    res.json(clients);
  } catch (err) {
    console.error('Clients error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Impossible de charger les clients depuis Frame.io' });
  }
});

// List folders for a project (SXX + Youtube only)
router.get('/clients/:projectId/folders', async (req, res) => {
  try {
    const folders = await listProjectFolders(req.params.projectId);
    res.json(folders);
  } catch (err) {
    console.error('Folders error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Impossible de charger les dossiers' });
  }
});

// Upload endpoint — up to 3 files
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
        frameio_link: result.view_url || ''
      });
    }

    // Create a public share link with comments enabled
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

module.exports = router;
