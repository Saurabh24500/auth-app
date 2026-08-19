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
const { sendOtpEmail, sendWelcomeEmail, buildTransporter, getLastPreviewUrl, isUsingPreview } = require('./mailer');
const supabase = require('./supabase');
const firebase = require('./firebase');

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const OTP_TTL_MS = 10 * 60 * 1000;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const captchaStore = new Map();
const otpSendLog = new Map(); // userId -> { count, lastSentAt }
const otpAttempts = new Map(); // `userId:channel` -> { count, resetAt }

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

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

async function issueOtp(user, destination) {
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
  otpAttempts.delete(`${user.id}:email`);

  const otp = generateOtp();
  await data.insertOtp({
    userId: user.id,
    codeHash: hashCode(`${user.id}:${otp}`),
    channel: 'email',
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });

  const sent = await sendOtpEmail(destination, otp, `${user.first_name} ${user.last_name}`);
  if (sent === 'console') {
    const err = new Error(
      'We could not send the verification email (email delivery is not configured). Please contact support or try again later.'
    );
    err.status = 503;
    throw err;
  }
}

async function verifyOtpFor(userId, channel, otp) {
  if (!otp || !/^[0-9]{6}$/.test(String(otp))) {
    const err = new Error('Enter the 6-digit code.');
    err.status = 400;
    throw err;
  }
  const row = await data.latestActiveOtp(userId, channel);
  if (!row) {
    const err = new Error('Code is invalid or expired. Request a new one.');
    err.status = 400;
    throw err;
  }
  const key = `${userId}:${channel}`;
  const attempt = otpAttempts.get(key) || { count: 0, resetAt: 0 };
  if (attempt.count >= MAX_OTP_ATTEMPTS && Date.now() < attempt.resetAt) {
    await data.markOtpUsed(row.id);
    const err = new Error('Too many wrong attempts. Request a new code.');
    err.status = 429;
    throw err;
  }
  const expected = hashCode(`${userId}:${String(otp)}`);
  if (row.code_hash !== expected) {
    attempt.count += 1;
    attempt.resetAt = Date.now() + OTP_TTL_MS;
    otpAttempts.set(key, attempt);
    if (attempt.count >= MAX_OTP_ATTEMPTS) await data.markOtpUsed(row.id);
    const err = new Error('Incorrect code.');
    err.status = 400;
    throw err;
  }
  otpAttempts.delete(key);
  await data.markOtpUsed(row.id);
  return row;
}

app.post('/api/captcha', (req, res) => {
  cleanupCaptchas();
  const challenge = setCaptcha();
  const dev = process.env.NODE_ENV !== 'production';
  const answer = dev ? captchaStore.get(challenge.id)?.answer : undefined;
  res.json({ ok: true, id: challenge.id, svg: challenge.svg, ...(answer ? { answer } : {}) });
});

app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, password, confirmPassword, captchaId, captchaAnswer } = req.body;

    const errName1 = validateName(firstName, 'First name');
    const errName2 = validateName(lastName, 'Last name');
    if (errName1 || errName2) return res.status(400).json({ ok: false, error: errName1 || errName2 });

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email is required.' });
    }

    let emailVal = null;
    let mobileVal = null;
    {
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

    if (existing) {
      return res.status(409).json({
        ok: false,
        redirect: '/login',
        error: 'An account with this email already exists. Please log in to continue.',
      });
    }

    const user = await data.createUser({
      firstName,
      lastName,
      email: emailVal,
      mobile: mobileVal,
      password,
    });

    const channel = emailVal ? 'email' : 'sms';
    const destination = emailVal || mobileVal;
    const firebaseSms = channel === 'sms';

    if (emailVal && mobileVal) {
      await emailDomainHasMailServer(emailVal).then((hasMx) => {
        if (hasMx === false) {
          console.warn(`[WARN] Email domain has no mail server: ${emailVal}`);
        }
      }).catch(() => {});
    }

    if (channel === 'email') {
      await issueOtp(user, destination);
    } else if (!firebase.isConfigured()) {
      return res.status(400).json({
        ok: false,
        error: 'SMS verification is not configured yet. Use an email address or set up Firebase.',
      });
    }

    await regenerateSession(req);
    req.session.pendingUserId = user.id;
    req.session.otpChannel = channel;
    req.session.otpDestination = destination;

    res.json({
      ok: true,
      channel,
      firebase: firebaseSms,
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

    if (channel === 'sms') {
      return res.json({ ok: true, channel: 'sms', firebase: true, masked: maskIdentifier(destination) });
    }

    await issueOtp(user, destination);
    req.session.otpChannel = channel;
    req.session.otpDestination = destination;
    res.json({ ok: true, channel, firebase: false, masked: maskIdentifier(destination) });
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
  try {
    await verifyOtpFor(userId, channel, otp);
  } catch (err) {
    return res.status(err.status || 400).json({ ok: false, error: err.message });
  }

  await data.markUserVerified(userId);
  await data.recordLogin(userId);

  const verifiedUser = await data.findUserById(userId);
  if (verifiedUser && verifiedUser.email) {
    sendWelcomeEmail(verifiedUser.email, `${verifiedUser.first_name} ${verifiedUser.last_name}`)
      .catch((e) => console.error('[EMAIL] Welcome email failed:', e.message));
  }

  await regenerateSession(req);
  req.session.userId = userId;
  delete req.session.pendingUserId;
  const user = await data.findUserById(userId);
  res.json({ ok: true, name: `${user.first_name} ${user.last_name}` });
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const r = validateEmail(email);
    if (typeof r === 'string') return res.status(400).json({ ok: false, error: r });

    const user = await data.findUserByEmail(r.email);
    if (user) {
      await issueOtp(user, r.email);
      await regenerateSession(req);
      req.session.resetUserId = user.id;
      req.session.otpChannel = 'email';
      req.session.otpDestination = r.email;
    }
    res.json({ ok: true, masked: maskIdentifier(r.email) });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ ok: false, error: status === 500 ? 'Failed to send reset code.' : err.message });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const userId = req.session.resetUserId;
    if (!userId) return res.status(401).json({ ok: false, error: 'No password reset in progress.' });

    const { otp, password, confirmPassword } = req.body;
    const passErr = validatePassword(password);
    if (passErr) return res.status(400).json({ ok: false, error: passErr });
    if (password !== confirmPassword) {
      return res.status(400).json({ ok: false, error: 'Passwords do not match.' });
    }

    await verifyOtpFor(userId, 'email', otp);
    const hash = await bcrypt.hash(password, 10);
    await data.updatePassword(userId, hash);

    req.session.destroy(() => res.json({ ok: true }));
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ ok: false, error: status === 500 ? 'Failed to reset password.' : err.message });
  }
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
      return res.status(401).json({
        ok: false,
        error: 'No account found with that email/mobile. Check the spelling, or create a new account.',
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await data.upsertLoginAttempt(key);
      const updated = await data.getLoginAttempt(key);
      if (updated.locked_until && new Date(updated.locked_until) > new Date()) {
        return res.status(429).json({ ok: false, error: 'Too many failed attempts. Account is locked for 15 minutes.' });
      }
      return res.status(401).json({
        ok: false,
        error: 'Incorrect password. Try again, or reset it from the login page.',
      });
    }

    await data.clearLoginAttempt(key);

    if (!user.verified) {
      await regenerateSession(req);
      req.session.pendingUserId = user.id;
      const channel = user.email ? 'email' : 'sms';
      const destination = user.email ? user.email : user.mobile;

      if (channel === 'email') {
        await issueOtp(user, destination);
      } else if (!firebase.isConfigured()) {
        return res.status(400).json({
          ok: false,
          error: 'SMS verification is not configured yet. Use an email address or set up Firebase.',
        });
      }

      req.session.otpChannel = channel;
      req.session.otpDestination = destination;
      return res.json({ ok: true, needOtp: true, channel, firebase: channel === 'sms', masked: maskIdentifier(destination) });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await data.recordLogin(user.id);
    res.json({ ok: true, name: `${user.first_name} ${user.last_name}` });
  } catch (err) {
    console.error(err);
    const status = err.status || 500;
    const msg = status === 500 ? 'Login failed. Please try again.' : err.message;
    res.status(status).json({ ok: false, error: msg });
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
    createdAt: user.created_at,
    verifiedAt: user.verified_at || null,
    lastLoginAt: user.last_login_at || null,
  });
});

app.get('/api/login-history', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: 'Not logged in.' });
  try {
    const history = await data.loginHistory(req.session.userId, 10);
    res.json({ ok: true, history });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to load login history.' });
  }
});

app.post('/api/delete-account', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: 'Not logged in.' });
  try {
    const user = await data.findUserById(req.session.userId);
    if (!user) return res.status(404).json({ ok: false, error: 'Account not found.' });
    await data.deleteUser(user.id);
    req.session.destroy(() => res.json({ ok: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to delete account.' });
  }
});

app.get('/api/pending', (req, res) => {
  if (!req.session.pendingUserId) return res.json({ ok: false });
  const destination = req.session.otpDestination || '';
  res.json({
    ok: true,
    channel: req.session.otpChannel || 'email',
    destination,
    firebase: (req.session.otpChannel || 'email') === 'sms',
    masked: maskIdentifier(destination),
  });
});

if (process.env.NODE_ENV !== 'production') {
  app.get('/api/dev/last-email', (req, res) => {
    const url = getLastPreviewUrl();
    res.json({ ok: !!url, usingPreview: isUsingPreview(), url });
  });
}

app.get('/api/firebase/config', (req, res) => {
  if (!firebase.isConfigured()) return res.json({ ok: false, error: 'Firebase is not configured.' });
  res.json({ ok: true, ...firebase.webConfig() });
});

app.post('/api/firebase/verify-token', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ ok: false, error: 'Missing verification token.' });

  let decoded;
  try {
    decoded = await firebase.verifyIdToken(idToken);
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Invalid verification token.' });
  }

  const phone = decoded.phone_number;
  if (!phone) return res.status(400).json({ ok: false, error: 'Token has no phone number.' });

  const user = await data.findUserByMobile(phone);
  if (!user) return res.status(400).json({ ok: false, error: 'No account found for this phone number.' });

  const expected = req.session.otpDestination || user.mobile;
  if (req.session.pendingUserId && user.id !== req.session.pendingUserId) {
    return res.status(409).json({ ok: false, error: 'Phone number does not match your pending verification.' });
  }
  if (req.session.otpChannel && req.session.otpChannel !== 'sms') {
    return res.status(409).json({ ok: false, error: 'This session is not pending SMS verification.' });
  }
  if (String(expected).replace(/\s+/g, '') !== String(phone).replace(/\s+/g, '')) {
    return res.status(409).json({ ok: false, error: 'Phone number does not match the registered number.' });
  }

  await data.markUserVerified(user.id);
  await data.recordLogin(user.id);
  await regenerateSession(req);
  req.session.userId = user.id;
  delete req.session.pendingUserId;
  res.json({ ok: true, name: `${user.first_name} ${user.last_name}` });
});

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forgot.html')));
app.get('/reset-password', (req, res) => {
  if (!req.session.resetUserId) return res.redirect('/forgot-password');
  res.sendFile(path.join(__dirname, 'public', 'reset.html'));
});
app.get('/verify', (req, res) => {
  if (!req.session.pendingUserId && !req.session.userId) return res.redirect('/register');
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});
app.get('/dashboard', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Auth app running:  http://localhost:${PORT}\n`);

  if (data.DRIVER === 'supabase') {
    supabase.status().then((dbStatus) => {
      console.log(
        dbStatus.usable
          ? `  Database:          Supabase (key accepted: ${dbStatus.keyLabel})\n`
          : `  Database:          Supabase - NO VALID KEY! None of the keys in .env are accepted by the project.\n`
      );
    }).catch(() => {
      console.log('  Database:          Supabase - connection check failed\n');
    });
  } else {
    console.log('  Database:          SQLite (auth.db)\n');
  }

  console.log('  Pages: /login  /register  /verify  /forgot-password  /reset-password  /dashboard\n');
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') {
      console.error('  WARN: No SMTP_HOST set in production - verification emails cannot be sent!\n');
    } else {
      console.log('  NOTE: No SMTP_HOST set - using Ethereal preview inbox in development.\n');
    }
  }
  buildTransporter();

  // Two-bucket cleanup: drop stale unverified accounts (attempts/spam) so only
  // verified users remain as the real auth users. Runs once now and every 6h.
  data.purgeUnverified(24).catch((e) => console.error('[PURGE] failed:', e.message));
  setInterval(() => {
    data.purgeUnverified(24).catch((e) => console.error('[PURGE] failed:', e.message));
  }, 6 * 60 * 60 * 1000);
  if (!firebase.isConfigured()) {
    console.log('  NOTE: Firebase not configured - SMS verification is disabled.\n');
  } else {
    console.log('  SMS verification: Firebase Phone Auth (free tier)\n');
  }
});
