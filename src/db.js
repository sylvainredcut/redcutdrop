const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'data', 'framedrop.db');

const fs = require('fs');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    client TEXT NOT NULL,
    week TEXT NOT NULL,
    filesize INTEGER,
    frameio_asset_id TEXT,
    frameio_link TEXT,
    uploaded_by TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add uploaded_by column if missing (migration)
try { db.exec('ALTER TABLE uploads ADD COLUMN uploaded_by TEXT'); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_clients (
    user_id INTEGER NOT NULL,
    client_project_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    PRIMARY KEY (user_id, client_project_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

function recordUpload({ filename, client, week, filesize, frameio_asset_id, frameio_link, uploaded_by }) {
  const stmt = db.prepare(`
    INSERT INTO uploads (filename, client, week, filesize, frameio_asset_id, frameio_link, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(filename, client, week, filesize, frameio_asset_id, frameio_link, uploaded_by || null);
}

function getRecentUploads(limit = 50) {
  return db.prepare('SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT ?').all(limit);
}

// --- User management ---
function createUser(email, password, name) {
  const hash = bcrypt.hashSync(password, 10);
  return db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, name);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function verifyUser(email, password) {
  const user = getUserByEmail(email);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, name: user.name };
}

function listUsers() {
  return db.prepare('SELECT id, email, name, created_at FROM users ORDER BY name').all();
}

function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// --- User-client access management ---
function getUserClients(userId) {
  return db.prepare('SELECT client_project_id, client_name FROM user_clients WHERE user_id = ?').all(userId);
}

function setUserClients(userId, clients) {
  const del = db.prepare('DELETE FROM user_clients WHERE user_id = ?');
  const ins = db.prepare('INSERT INTO user_clients (user_id, client_project_id, client_name) VALUES (?, ?, ?)');
  const txn = db.transaction((uid, cls) => {
    del.run(uid);
    for (const c of cls) {
      ins.run(uid, c.id, c.name);
    }
  });
  txn(userId, clients);
}

function getAllUserClients() {
  return db.prepare('SELECT user_id, client_project_id FROM user_clients').all();
}

module.exports = { recordUpload, getRecentUploads, createUser, getUserByEmail, verifyUser, listUsers, deleteUser, getUserClients, setUserClients, getAllUserClients };
