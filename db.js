const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, 'auth.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    email         TEXT UNIQUE,
    mobile        TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    verified      INTEGER NOT NULL DEFAULT 0,
    verified_at   TEXT,
    last_login_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS otps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    channel    TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    email_or_mobile TEXT PRIMARY KEY,
    count           INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT
  );

  CREATE TABLE IF NOT EXISTS logins (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_at  TEXT NOT NULL
  );
`);

const userCols = db.prepare(`PRAGMA table_info('users')`).all().map((c) => c.name);
if (!userCols.includes('verified_at')) db.exec(`ALTER TABLE users ADD COLUMN verified_at TEXT`);
if (!userCols.includes('last_login_at')) db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`);

const userStmts = {
  findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findByMobile: db.prepare('SELECT * FROM users WHERE mobile = ?'),
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findByEmailOrMobile: db.prepare('SELECT * FROM users WHERE email = ? OR mobile = ?'),
  insert: db.prepare(
    'INSERT INTO users (first_name, last_name, email, mobile, password_hash) VALUES (?, ?, ?, ?, ?)'
  ),
  verify: db.prepare('UPDATE users SET verified = 1, verified_at = ? WHERE id = ?'),
  updateLastLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  delete: db.prepare('DELETE FROM users WHERE id = ?'),
  purgeUnverified: db.prepare(
    "DELETE FROM users WHERE verified = 0 AND created_at < datetime('now', '-' || ? || ' hours')"
  ),
};

const loginStmts = {
  insert: db.prepare('INSERT INTO logins (user_id, login_at) VALUES (?, ?)'),
  history: db.prepare('SELECT * FROM logins WHERE user_id = ? ORDER BY id DESC LIMIT ?'),
};

const otpStmts = {
  insert: db.prepare(
    'INSERT INTO otps (user_id, code_hash, channel, expires_at) VALUES (?, ?, ?, ?)'
  ),
  latestActive: db.prepare(
    "SELECT * FROM otps WHERE user_id = ? AND channel = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1"
  ),
  markUsed: db.prepare('UPDATE otps SET used = 1 WHERE id = ?'),
};

const attemptStmts = {
  get: db.prepare('SELECT * FROM login_attempts WHERE email_or_mobile = ?'),
  insert: db.prepare(
    'INSERT INTO login_attempts (email_or_mobile, count, locked_until) VALUES (?, ?, ?)'
  ),
  update: db.prepare('UPDATE login_attempts SET count = ?, locked_until = ? WHERE email_or_mobile = ?'),
  clear: db.prepare('DELETE FROM login_attempts WHERE email_or_mobile = ?'),
};

module.exports = { db, userStmts, otpStmts, attemptStmts, loginStmts };
