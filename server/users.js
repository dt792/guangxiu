// User accounts: node:sqlite storage, werkzeug-compatible password hashes (scrypt/pbkdf2),
// in-memory token store (port of flask_backend/UserManager.py).
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DATA_DIR } from './config.js';

const DB_PATH = path.join(DATA_DIR, 'users.db');
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// ---------- werkzeug-compatible hashing ----------

const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function genSalt(len = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(crypto.randomBytes(len)).map((b) => chars[b % chars.length]).join('');
}

export function hashPassword(password) {
  const salt = genSalt();
  const hash = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
  return `scrypt:32768:8:1$${salt}$${hash.toString('hex')}`;
}

export function checkPassword(stored, password) {
  try {
    const [method, salt, hashHex] = stored.split('$');
    let derived;
    if (method.startsWith('scrypt')) {
      const [, n, r, p] = method.split(':').map((v, i) => (i ? parseInt(v, 10) : v));
      derived = crypto.scryptSync(password, salt, hashHex.length / 2,
        { N: n, r, p, maxmem: SCRYPT_MAXMEM });
    } else if (method.startsWith('pbkdf2')) {
      const [, hashName = 'sha256', iterations = '600000'] = method.split(':');
      derived = crypto.pbkdf2Sync(password, salt, parseInt(iterations, 10),
        hashHex.length / 2, hashName);
    } else {
      return false;
    }
    return crypto.timingSafeEqual(derived, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

// ---------- account CRUD ----------

export function createAccount(username, password, userId) {
  try {
    db.prepare(
      'INSERT INTO accounts (username, password_hash, user_id, created_at) VALUES (?,?,?,?)'
    ).run(username, hashPassword(password), userId, new Date().toISOString());
    return true;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return false;
    throw e;
  }
}

export function getAccountByUsername(username) {
  return db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) ?? null;
}

export function verifyPasswordByUsername(username, password) {
  const account = getAccountByUsername(username);
  if (account && checkPassword(account.password_hash, password)) return account;
  return null;
}

// ---------- token store (SQLite persisted, survives restarts) ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expire_at TEXT NOT NULL
  )
`);

export function issueToken(userId) {
  db.prepare('DELETE FROM tokens WHERE expire_at < ?').run(new Date().toISOString());
  const token = crypto.randomBytes(16).toString('hex');
  const expireAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  db.prepare('INSERT INTO tokens (token, user_id, expire_at) VALUES (?,?,?)')
    .run(token, userId, expireAt);
  return token;
}

export function resolveToken(token) {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expire_at FROM tokens WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expire_at < new Date().toISOString()) {
    db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
    return null;
  }
  return row.user_id;
}

export function revokeToken(token) {
  db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
}
