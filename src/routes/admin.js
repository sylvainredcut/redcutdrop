const express = require('express');
const { getRecentUploads, createUser, listUsers, deleteUser, getUserByEmail, getUserClients, setUserClients, getAllUserClients } = require('../db');
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

// --- User management ---
router.get('/users', (req, res) => {
  try {
    res.json(listUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, mot de passe et nom requis' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  }
  if (getUserByEmail(email)) {
    return res.status(409).json({ error: 'Cet email existe déjà' });
  }
  try {
    createUser(email, password, name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', (req, res) => {
  try {
    deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- User-client access management ---
router.get('/users/:id/clients', (req, res) => {
  try {
    const clients = getUserClients(parseInt(req.params.id));
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id/clients', (req, res) => {
  const { clients } = req.body; // [{id, name}, ...]
  if (!Array.isArray(clients)) {
    return res.status(400).json({ error: 'clients doit être un tableau' });
  }
  try {
    setUserClients(parseInt(req.params.id), clients);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users-clients', (req, res) => {
  try {
    res.json(getAllUserClients());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
