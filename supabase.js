require('dotenv').config();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

const CANDIDATE_KEYS = [
  process.env.SUPABASE_SECRET_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_PUBLISHABLE_KEY,
].filter(Boolean);

const isConfigured = !!(SUPABASE_URL && CANDIDATE_KEYS.length);

let activeKey = null;

async function resolveKey() {
  if (activeKey) return activeKey;
  for (const key of CANDIDATE_KEYS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.status === 401) continue;
      activeKey = key;
      return key;
    } catch {
      continue;
    }
  }
  return null;
}

function keyLabel(key) {
  if (!key) return 'none';
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  if (key.startsWith('sb_')) return 'supabase-key';
  return 'custom-jwt';
}

async function status() {
  const key = await resolveKey();
  return { url: SUPABASE_URL, keyLabel: keyLabel(key), usable: !!key };
}

async function request(path, { method = 'GET', body, headers = {}, query = '' } = {}) {
  const key = await resolveKey();
  if (!key) {
    const err = new Error(
      `Supabase connection failed: none of the configured keys are accepted by ${SUPABASE_URL}. ` +
        `Check SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY in .env (must belong to this project).`
    );
    err.status = 500;
    throw err;
  }

  const url = `${SUPABASE_URL}/rest/v1${path}${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Supabase error ${res.status}: ${text}`);
    err.status = res.status === 401 || res.status === 403 ? 500 : res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const q = encodeURIComponent;

module.exports = {
  isConfigured,
  status,

  findUserByEmail(email) {
    return request(`/users?email=eq.${q(email)}&limit=1`).then((rows) => rows[0] || null);
  },

  findUserByMobile(mobile) {
    return request(`/users?mobile=eq.${q(mobile)}&limit=1`).then((rows) => rows[0] || null);
  },

  findUserById(id) {
    return request(`/users?id=eq.${q(id)}&limit=1`).then((rows) => rows[0] || null);
  },

  createUser({ firstName, lastName, email, mobile, passwordHash }) {
    return request('/users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        first_name: firstName,
        last_name: lastName,
        email,
        mobile,
        password_hash: passwordHash,
      },
    }).then((rows) => rows[0] || null);
  },

  markUserVerified(id) {
    return request(`/users?id=eq.${q(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { verified: true, verified_at: new Date().toISOString() },
    }).then((rows) => rows[0] || null);
  },

  updateLastLogin(id) {
    return request(`/users?id=eq.${q(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { last_login_at: new Date().toISOString() },
    }).then((rows) => rows[0] || null);
  },

  updatePassword(id, passwordHash) {
    return request(`/users?id=eq.${q(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { password_hash: passwordHash },
    }).then((rows) => rows[0] || null);
  },

  deleteUser(id) {
    return request(`/users?id=eq.${q(id)}`, { method: 'DELETE' });
  },

  deleteUnverified(cutoffIso) {
    return request(`/users?verified=eq.false&created_at=lt.${q(cutoffIso)}`, { method: 'DELETE' });
  },

  insertLogin(userId) {
    return request('/logins', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { user_id: userId, login_at: new Date().toISOString() },
    }).then((rows) => rows[0] || null);
  },

  loginHistory(userId, limit = 10) {
    return request(`/logins?user_id=eq.${q(userId)}&order=id.desc&limit=${q(limit)}`).then(
      (rows) => rows || []
    );
  },

  insertOtp({ userId, codeHash, channel, expiresAt }) {
    return request('/otps', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        user_id: userId,
        code_hash: codeHash,
        channel,
        expires_at: expiresAt,
      },
    }).then((rows) => rows[0] || null);
  },

  latestActiveOtp(userId, channel) {
    return request(
      `/otps?user_id=eq.${q(userId)}&channel=eq.${q(channel)}&used=eq.false&expires_at=gt.${q(
        new Date().toISOString()
      )}&order=id.desc&limit=1`
    ).then((rows) => rows[0] || null);
  },

  markOtpUsed(id) {
    return request(`/otps?id=eq.${q(id)}`, {
      method: 'PATCH',
      body: { used: true },
    });
  },

  getLoginAttempt(key) {
    return request(`/login_attempts?email_or_mobile=eq.${q(key)}&limit=1`).then(
      (rows) => rows[0] || null
    );
  },

  upsertLoginAttempt(key, count, lockedUntil) {
    return request('/login_attempts?on_conflict=email_or_mobile', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: { email_or_mobile: key, count, locked_until: lockedUntil },
    });
  },

  clearLoginAttempt(key) {
    return request(`/login_attempts?email_or_mobile=eq.${q(key)}`, { method: 'DELETE' });
  },
};