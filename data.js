require('dotenv').config();
const bcrypt = require('bcryptjs');

const sqlite = require('./db');
const supabase = require('./supabase');

const DRIVER = supabase.isConfigured ? 'supabase' : 'sqlite';

const LOCK_MS = 15 * 60 * 1000;

async function findUserByEmail(email) {
  return DRIVER === 'supabase' ? supabase.findUserByEmail(email) : sqlite.userStmts.findByEmail.get(email);
}

async function findUserByMobile(mobile) {
  return DRIVER === 'supabase' ? supabase.findUserByMobile(mobile) : sqlite.userStmts.findByMobile.get(mobile);
}

async function findUserById(id) {
  return DRIVER === 'supabase' ? supabase.findUserById(id) : sqlite.userStmts.findById.get(id);
}

async function findUserByIdentifier(identifier) {
  const user = (await findUserByEmail(identifier)) || (await findUserByMobile(identifier));
  return user;
}

async function createUser({ firstName, lastName, email, mobile, password }) {
  const passwordHash = await bcrypt.hash(password, 10);
  if (DRIVER === 'supabase') {
    const user = await supabase.createUser({ firstName, lastName, email, mobile, passwordHash });
    return supabase.findUserById(user.id);
  }
  const result = sqlite.userStmts.insert.run(firstName.trim(), lastName.trim(), email, mobile, passwordHash);
  return sqlite.userStmts.findById.get(result.lastInsertRowid);
}

async function markUserVerified(id) {
  if (DRIVER === 'supabase') return supabase.markUserVerified(id);
  sqlite.userStmts.verify.run(id);
  return findUserById(id);
}

async function insertOtp({ userId, codeHash, channel, expiresAt }) {
  if (DRIVER === 'supabase') return supabase.insertOtp({ userId, codeHash, channel, expiresAt });
  const result = sqlite.otpStmts.insert.run(userId, codeHash, channel, expiresAt);
  return sqlite.otpStmts.latestActive.get(userId, channel);
}

async function latestActiveOtp(userId, channel) {
  if (DRIVER === 'supabase') return supabase.latestActiveOtp(userId, channel);
  return sqlite.otpStmts.latestActive.get(userId, channel);
}

async function markOtpUsed(id) {
  if (DRIVER === 'supabase') return supabase.markOtpUsed(id);
  sqlite.otpStmts.markUsed.run(id);
}

async function getLoginAttempt(key) {
  if (DRIVER === 'supabase') return supabase.getLoginAttempt(key);
  return sqlite.attemptStmts.get.get(key);
}

async function upsertLoginAttempt(key) {
  const row = await getLoginAttempt(key);
  const now = Date.now();
  const stillLocked = !!row && !!row.locked_until && new Date(row.locked_until) > now;

  let count = row ? row.count + 1 : 1;
  let lockedUntil = row ? row.locked_until : null;
  if (!stillLocked) {
    if (count >= 5) lockedUntil = new Date(now + LOCK_MS).toISOString();
    else lockedUntil = null;
  }

  if (DRIVER === 'supabase') return supabase.upsertLoginAttempt(key, count, lockedUntil);
  const result = sqlite.attemptStmts.update.run(count, lockedUntil, key);
  if (result.changes === 0) {
    sqlite.attemptStmts.insert.run(key, count, lockedUntil);
  }
}

async function clearLoginAttempt(key) {
  if (DRIVER === 'supabase') return supabase.clearLoginAttempt(key);
  sqlite.attemptStmts.clear.run(key);
}

module.exports = {
  DRIVER,
  findUserByEmail,
  findUserByMobile,
  findUserById,
  findUserByIdentifier,
  createUser,
  markUserVerified,
  insertOtp,
  latestActiveOtp,
  markOtpUsed,
  getLoginAttempt,
  upsertLoginAttempt,
  clearLoginAttempt,
};