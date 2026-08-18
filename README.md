<div align="center">

# 🔐 SecureAuth

### Bulletproof signup & login with captcha, strong passwords and real-time OTP verification

**Node.js · Express · Supabase · Email/SMS OTP**

[![Node](https://img.shields.io/badge/Node.js-v24-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)](https://expressjs.com)
[![Supabase](https://img.shields.io/badge/DB-Supabase%20%2F%20SQLite-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ What it does

A production-ready authentication system that keeps bots out and real users in:

| Feature | Details |
|---------|---------|
| 🧑‍🤝‍🧑 **Registration** | First name, last name, **email and/or mobile** (real email checked via DNS MX lookup) |
| 🛡️ **Captcha** | Auto-refreshing math captcha stops bots, with expiry + one-time use |
| 🔒 **Strong passwords** | Min 6 chars + uppercase + lowercase + digit + special char, with a **live strength meter** and rule checklist |
| 📧📱 **OTP verification** | 6-digit code via **email (SMTP)** or **SMS (Firebase Phone Auth)** — free tier, sent after signup *and* after login of unverified accounts |
| ⏳ **OTP hardening** | 10-min expiry, hashed storage, 60s resend cooldown, max 3 sends, **5 wrong attempts = code burned** |
| 🚫 **Brute-force lockout** | 5 failed logins = account locked 15 minutes |
| 🗄️ **Supabase storage** | Login details stored in cloud Postgres — auto-falls back to SQLite if unconfigured |
| 🔐 **Session security** | Regenerated session IDs (no fixation), httpOnly + secure cookies, security headers, bcrypt password hashing |

## 🚀 Quick start

```bash
git clone https://github.com/Saurabh24500/auth-app.git
cd auth-app
npm install
cp .env.example .env      # fill in your keys
npm start                 # → http://localhost:3000
```

> **Global access** (see it from any phone/device):
> ```bash
> npm start          # terminal 1
> npm run tunnel     # terminal 2 → prints a public URL
> ```

## 📋 Pages

- `/login` — email/mobile + password, auto-OTP for unverified accounts
- `/register` — full signup flow (names, contact, captcha, strong password)
- `/verify` — 6-digit OTP entry with resend countdown
- `/dashboard` — logged-in profile view (name, email, mobile, verified badge)

## 🔧 Environment variables (`.env`)

| Variable | Purpose | Required |
|----------|---------|----------|
| `PORT` | Server port | no (default 3000) |
| `SESSION_SECRET` | Session encryption | yes (already set) |
| `SUPABASE_URL` | Your Supabase project URL | for Supabase |
| `SUPABASE_SECRET_KEY` | Supabase server key (`sb_secret_...`) | for Supabase |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Gmail/SMTP for email OTP | for real emails |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` / `FIREBASE_WEB_API_KEY` | Firebase (for free SMS OTP) | for SMS |

> Without SMTP, email OTPs are printed to the server console (and logged in dev). SMS OTP uses **Firebase Phone Auth** (free tier, up to 10,000 verifications/month, global) — see the Firebase setup section below.

## 🗄️ Database

- **Supabase** (recommended): run `supabase/schema.sql` in the SQL Editor once. Tables: `users`, `otps`, `login_attempts` (+ RLS policies).
- **SQLite** (zero-config fallback): `auth.db`, auto-created on first run.
- The app **auto-detects** which to use and even probes your API keys at startup to pick the one your project accepts.

## 🔌 API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/captcha` | Get a captcha challenge (SVG) |
| `POST` | `/api/register` | Create account + send OTP |
| `POST` | `/api/verify-otp` | Verify the 6-digit code |
| `POST` | `/api/resend-otp` | Resend code (60s cooldown) |
| `POST` | `/api/login` | Log in (OTP sent if unverified) |
| `POST` | `/api/logout` | End session |
| `GET` | `/api/me` | Current user |

## 🧪 Tested

Full **end-to-end + adversarial** suite passed against the live Supabase database:

✅ register → captcha → OTP → verify → login &nbsp;·&nbsp; ✅ wrong captcha rejected &nbsp;·&nbsp; ✅ weak passwords rejected &nbsp;·&nbsp; ✅ OTP brute-force blocked (code burned after 5) &nbsp;·&nbsp; ✅ 60s resend cooldown &nbsp;·&nbsp; ✅ duplicate account → 409 &nbsp;·&nbsp; ✅ logout clears session &nbsp;·&nbsp; ✅ login lockout after 5 fails &nbsp;·&nbsp; ✅ fresh login

## 📦 Deploy to Render (free)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → connect your repo (it auto-uses `render.yaml`).
3. In the service's **Environment**, set the hidden values: `SUPABASE_SECRET_KEY`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, and the `FIREBASE_*` keys.

## 🔥 Free SMS OTP with Firebase (5 min setup)

1. Go to [firebase.google.com](https://firebase.google.com) → **Add project** → name it, create.
2. Enable phone auth: **Authentication → Sign-in method → Phone → Enable**.
3. Add your domains: **Authentication → Settings → Authorized domains** → add `localhost`, and your Render URL.
4. Get the service account: **Project Settings → Service accounts → Generate new private key** → download JSON → copy `project_id`, `client_email`, and `private_key` (keep `\n` in the key) into `.env`.
5. Get the web API key: **Project Settings → General → Your apps → Web app** → copy the `apiKey` into `FIREBASE_WEB_API_KEY`.
6. Restart the app. SMS OTPs now send for free — globally.

## 📄 Documentation

Detailed spec, data model and roadmap: see [PRD.md](PRD.md).

---

<div align="center">Built with ❤️ · Secure by design, not by accident</div>