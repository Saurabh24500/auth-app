require('dotenv').config();
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const data = require('./data');
const {
  validateName,
  validateEmail,
  validateMobile,
  validatePassword,
  emailDomainHasMailServer,
  maskIdentifier,
} = require('./validators');
const { generateChallenge, svgCaptcha } = require('./captcha');
const { sendOtpEmail } = require('./mailer');
const { sendOtpSms } = require('./sms');
const supabase = require('./supabase');

const app = express();
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login'));

const OTP_TTL_MS = 10 * 60 * 1000;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

const captchaStore = new Map();
const otpSendLog = new Map(); // userId -> { count, lastSentAt }

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function setCaptcha() {
  const challenge = generateChallenge();
  const id = crypto.randomUUID();
  captchaStore.set(id, { ...challenge, createdAt: Date.now() });
  return { id, svg: svgCaptcha(challenge.question) };
}

function cleanupCaptchas() {
  const now = Date.now();
  for (const [id, entry] of captchaStore) {
    if (now - entry.createdAt > CAPTCHA_TTL_MS) captchaStore.delete(id);
  }
}

async function issueOtp(user, channel, destination) {
  const now = Date.now();
  const log = otpSendLog.get(user.id) || { count: 0, lastSentAt: 0 };
  if (now - log.lastSentAt < 60 * 1000) {
    const err = new Error('Please wait at least 60 seconds before requesting another code.');
    err.status = 429;
    throw err;
  }
  if (log.count >= 3 && now - log.lastSentAt < OTP_TTL_MS) {
    const err = new Error('Too many codes requested. Try again later.');
    err.status = 429;
    throw err;
  }
  otpSendLog.set(user.id, { count: log.count + 1, lastSentAt: now });

  const otp = generateOtp();
  await data.insertOtp({
    userId: user.id,
    codeHash: hashCode(`${user.id}:${otp}`),
    channel,
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });

  if (channel === 'email') {
    await sendOtpEmail(destination, otp, `${user.first_name} ${user.last_name}`);
  } else {
    await sendOtpSms(destination, otp);
  }
}

app.post('/api/captcha', (req, res) => {
  cleanupCaptchas();
  res.json({ ok: true, ...setCaptcha() });
});

app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, password, confirmPassword, captchaId, captchaAnswer } = req.body;

    const errName1 = validateName(firstName, 'First name');
    const errName2 = validateName(lastName, 'Last name');
    if (errName1 || errName2) return res.status(400).json({ ok: false, error: errName1 || errName2 });

    if (!email && !mobile) {
      return res.status(400).json({ ok: false, error: 'Enter an email or a mobile number.' });
    }

    let emailVal = null;
    let mobileVal = null;
    if (email) {
      const r = validateEmail(email);
      if (typeof r === 'string') return res.status(400).json({ ok: false, error: r });
      emailVal = r.email;
    }
    if (mobile) {
      const r = validateMobile(mobile);
      if (typeof r === 'string') return res.status(400).json({ ok: false, error: r });
      mobileVal = r.mobile;
    }

    if (!captchaId || captchaAnswer === undefined) {
      return res.status(400).json({ ok: false, error: 'Complete the captcha.' });
    }
    const challenge = captchaStore.get(captchaId);
    if (!challenge || Date.now() - challenge.createdAt > CAPTCHA_TTL_MS) {
      return res.status(400).json({ ok: false, error: 'Captcha expired. Please refresh and try again.' });
    }
    if (String(challenge.answer).trim() !== String(captchaAnswer).trim()) {
      captchaStore.delete(captchaId);
      return res.status(400).json({ ok: false, error: 'Incorrect captcha answer.' });
    }
    captchaStore.delete(captchaId);

    const passErr = validatePassword(password);
    if (passErr) return res.status(400).json({ ok: false, error: passErr });
    if (password !== confirmPassword) {
      return res.status(400).json({ ok: false, error: 'Passwords do not match.' });
    }

    let existing = null;
    if (emailVal) existing = await data.findUserByEmail(emailVal);
    if (!existing && mobileVal) existing = await data.findUserByMobile(mobileVal);

    let user;
    if (existing) {
      if (existing.verified) {
        return res.status(409).json({ ok: false, error: 'An account with this email/mobile already exists. Please log in.' });
      }
      user = existing;
    } else {
      user = await data.createUser({
        firstName,
        lastName,
        email: emailVal,
        mobile: mobileVal,
        password,
      });
    }

    const channel = emailVal ? 'email' : 'sms';
    const destination = emailVal || mobileVal;

    if (emailVal && mobileVal) {
      await emailDomainHasMailServer(emailVal).then((hasMx) => {
        if (hasMx === false) {
          console.warn(`[WARN] Email domain has no mail server: ${emailVal}`);
        }
      }).catch(() => {});
    }

    await issueOtp(user, channel, destination);

    req.session.pendingUserId = user.id;
    req.session.otpChannel = channel;
    req.session.otpDestination = destination;

    res.json({
      ok: true,
      channel,
      masked: maskIdentifier(destination),
      name: `${user.first_name} ${user.last_name}`,
    });
  } catch (err) {
    const status = err.status || 500;
    const message = status === 500 ? 'Registration failed. Please try again.' : err.message;
    if (status === 500) console.error(err);
    res.status(status).json({ ok: false, error: message });
  }
});

app.post('/api/resend-otp', async (req, res) => {
  try {
    const userId = req.session.pendingUserId || req.session.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'No pending verification.' });
    const user = await data.findUserById(userId);
    if (!user) return res.status(401).json({ ok: false, error: 'User not found.' });

    const channel = req.session.otpChannel || (user.email ? 'email' : 'sms');
    const destination = req.session.otpDestination || (user.email ? user.email : user.mobile);
    await issueOtp(user, channel, destination);
    req.session.otpChannel = channel;
    req.session.otpDestination = destination;
    res.json({ ok: true, channel, masked: maskIdentifier(destination) });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ ok: false, error: status === 500 ? 'Failed to resend code.' : err.message });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  const { otp } = req.body;
  const userId = req.session.pendingUserId || req.session.userId;
  if (!userId) return res.status(401).json({ ok: false, error: 'No pending verification.' });

  const channel = req.session.otpChannel || 'email';
  if (!otp || !/^[0-9]{6}$/.test(String(otp))) {
    return res.status(400).json({ ok: false, error: 'Enter the 6-digit code.' });
  }

  const row = await data.latestActiveOtp(userId, channel);
  if (!row) {
    return res.status(400).json({ ok: false, error: 'Code is invalid or expired. Request a new one.' });
  }

  const expected = hashCode(`${userId}:${String(otp)}`);
  if (row.code_hash !== expected) {
    return res.status(400).json({ ok: false, error: 'Incorrect code.' });
  }

  await data.markOtpUsed(row.id);
  await data.markUserVerified(userId);

  req.session.userId = userId;
  delete req.session.pendingUserId;
  const user = await data.findUserById(userId);
  res.json({ ok: true, name: `${user.first_name} ${user.last_name}` });
});

app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ ok: false, error: 'Enter your email/mobile and password.' });
    }

    const key = String(identifier).trim().toLowerCase();
    const attempt = await data.getLoginAttempt(key);
    if (attempt && attempt.locked_until && new Date(attempt.locked_until) > new Date()) {
      return res.status(429).json({
        ok: false,
        error: 'Too many failed attempts. Account is locked for 15 minutes.',
      });
    }

    const user = await data.findUserByIdentifier(key);

    if (!user) {
      await data.upsertLoginAttempt(key);
      return res.status(401).json({ ok: false, error: 'No account found with that email/mobile.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await data.upsertLoginAttempt(key);
      const updated = await data.getLoginAttempt(key);
      if (updated.locked_until && new Date(updated.locked_until) > new Date()) {
        return res.status(429).json({ ok: false, error: 'Too many failed attempts. Account is locked for 15 minutes.' });
      }
      return res.status(401).json({ ok: false, error: 'Incorrect password.' });
    }

    await data.clearLoginAttempt(key);

    if (!user.verified) {
      req.session.pendingUserId = user.id;
      const channel = user.email ? 'email' : 'sms';
      const destination = user.email ? user.email : user.mobile;
      req.session.otpChannel = channel;
      req.session.otpDestination = destination;
      await issueOtp(user, channel, destination);
      return res.json({ ok: true, needOtp: true, channel, masked: maskIdentifier(destination) });
    }

    req.session.userId = user.id;
    res.json({ ok: true, name: `${user.first_name} ${user.last_name}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Login failed. Please try again.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ ok: false });
  const user = await data.findUserById(req.session.userId);
  if (!user) return res.json({ ok: false });
  res.json({
    ok: true,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    mobile: user.mobile,
    verified: !!user.verified,
  });
});

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/verify', (req, res) => {
  if (!req.session.pendingUserId && !req.session.userId) return res.redirect('/register');
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});
app.get('/dashboard', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n  Auth app running:  http://localhost:${PORT}\n`);

  if (data.DRIVER === 'supabase') {
    const dbStatus = await supabase.status().catch(() => ({ usable: false, keyLabel: 'none' }));
    console.log(
      dbStatus.usable
        ? `  Database:          Supabase (key accepted: ${dbStatus.keyLabel})\n`
        : `  Database:          Supabase - NO VALID KEY! None of the keys in .env are accepted by the project.\n`
    );
  } else {
    console.log('  Database:          SQLite (auth.db)\n');
  }

  console.log('  Pages: /login  /register  /verify  /dashboard\n');
  if (!process.env.SMTP_HOST && !process.env.TWILIO_ACCOUNT_SID) {
    console.log('  NOTE: No SMTP/Twilio configured - OTPs are printed to this console.\n');
  }
});
