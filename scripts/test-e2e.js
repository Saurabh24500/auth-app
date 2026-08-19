const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

function waitForServer(proc) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('Auth app running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
}

async function post(route, body, cookieJar) {
  const res = await fetch(BASE + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookieJar.value ? { Cookie: cookieJar.value } : {}) },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar.value = setCookie.split(';')[0];
  return { status: res.status, json: await res.json() };
}

(async () => {
  const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'development' };
  const server = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env });
  let otp = null;
  server.stdout.on('data', (d) => {
    const line = d.toString();
    process.stdout.write(line);
    const m = line.match(/\[EMAIL\]\[dev\] OTP for .*?: (\d{6})/);
    if (m) otp = m[1];
  });

  try {
    await waitForServer(server);

    // 1) get captcha, then register
    const cookie = { value: null };
    const cap = await post('/api/captcha', {}, cookie);
    console.log('CAPTCHA ->', JSON.stringify(cap.json));
    const reg = await post('/api/register', {
      firstName: 'Test', lastName: 'User',
      email: 'e2e-' + Date.now() + '@example.com',
      password: 'Passw0rd!', confirmPassword: 'Passw0rd!',
      captchaId: cap.json.id, captchaAnswer: cap.json.answer,
    }, cookie);
    console.log('REGISTER ->', reg.status, JSON.stringify(reg.json));

    // wait for OTP log
    for (let i = 0; i < 50 && !otp; i++) await new Promise((r) => setTimeout(r, 100));
    console.log('Captured OTP:', otp);

    const me = await post('/api/verify-otp', { otp }, cookie);
    console.log('VERIFY OTP ->', me.status, JSON.stringify(me.json));

    const email = await (await fetch(BASE + '/api/dev/last-email')).json();
    console.log('DEV last-email ->', JSON.stringify(email));

    if (me.json.ok && otp) {
      console.log('\nE2E RESULT: PASS (register -> OTP email -> verify all worked)');
      process.exitCode = 0;
    } else {
      console.log('\nE2E RESULT: FAIL');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('E2E ERROR:', e);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
})();
