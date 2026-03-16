const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadFile, listClients, listProjectFolders } = require('../frameio');
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

// Upload endpoint (public)
router.post('/upload', upload.single('video'), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Aucun fichier envoye' });
  }

  const { projectId, clientName, week } = req.body;

  if (!projectId || !clientName || !week) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Client et semaine requis' });
  }

  try {
    const result = await uploadFile(
      file.path,
      file.originalname,
      file.size,
      file.mimetype,
      projectId,
      week
    );

    fs.unlinkSync(file.path);

    recordUpload({
      filename: file.originalname,
      client: clientName,
      week,
      filesize: file.size,
      frameio_asset_id: result.id,
      frameio_link: result.link
    });

    sendDiscordNotification({
      filename: file.originalname,
      client: clientName,
      week,
      filesize: file.size,
      link: result.link
    });

    res.json({ ok: true, asset: result });
  } catch (err) {
    try { fs.unlinkSync(file.path); } catch {}
    console.error('Upload error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || err.message || 'Upload echoue'
    });
  }
});

module.exports = router;
