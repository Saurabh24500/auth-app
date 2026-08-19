require('dotenv').config();

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/rest/v1';
const KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function wipe(table, filter) {
  const res = await fetch(`${BASE}/${table}?${filter}`, { method: 'DELETE', headers });
  if (!res.ok) {
    const t = await res.text();
    console.error(`Wipe ${table} FAILED (${res.status}):`, t);
  } else {
    console.log(`Wiped ${table}`);
  }
}

async function remaining(table) {
  const res = await fetch(`${BASE}/${table}?select=*`, { headers });
  const rows = await res.json();
  console.log(`  ${table}: ${Array.isArray(rows) ? rows.length : '?'} row(s)`);
}

(async () => {
  console.log('Wiping all auth data in Supabase...');
  await wipe('otps', 'id=gte.0');
  await wipe('logins', 'id=gte.0');
  await wipe('login_attempts', 'email_or_mobile=like.*');
  await wipe('users', 'id=gte.0');

  console.log('\nRemaining rows:');
  await remaining('users');
  await remaining('otps');
  await remaining('logins');
  await remaining('login_attempts');
})();
