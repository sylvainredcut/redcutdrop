const express = require('express');
const { getRecentUploads } = require('../db');
const { listClients } = require('../frameio');

const router = express.Router();

router.get('/uploads', (req, res) => {
  try {
    const uploads = getRecentUploads(100);
    res.json(uploads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects', async (req, res) => {
  try {
    const projects = await listClients();
    res.json(projects);
  } catch (err) {
    console.error('Projects error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || err.message || 'Erreur Frame.io'
    });
  }
});

module.exports = router;
