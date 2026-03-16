const Database = require('better-sqlite3');
const path = require('path');

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
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function recordUpload({ filename, client, week, filesize, frameio_asset_id, frameio_link }) {
  const stmt = db.prepare(`
    INSERT INTO uploads (filename, client, week, filesize, frameio_asset_id, frameio_link)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(filename, client, week, filesize, frameio_asset_id, frameio_link);
}

function getRecentUploads(limit = 50) {
  return db.prepare('SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT ?').all(limit);
}

module.exports = { recordUpload, getRecentUploads };
