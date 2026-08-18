# PRD — Secure Auth App (Login + Registration + OTP Verification)

## 1. Overview

A secure signup/login system with:

- Registration (first name, last name, **email or mobile**)
- Math **captcha** (are-you-human check)
- **Strong password** validation
- **OTP verification** sent via **email or SMS** after registration/login
- **Supabase** database for storing login details
- Local **SQLite** fallback so the app runs with zero config while you set up Supabase

## 2. What is ALREADY DONE (implemented and tested)

| # | Feature | Status |
|---|---------|--------|
| 1 | Registration form with first name, last name, email and/or mobile | Done |
| 2 | Email format + mobile format validation (real format check) | Done |
| 3 | **Real email check** — DNS MX lookup on the email domain (rejects fake domains with no mail server, logged as a warning) | Done |
| 4 | Math captcha (auto-refreshing SVG) with expiry | Done |
| 5 | Password rules: min 6 chars + uppercase + lowercase + digit + special char; live strength meter + checklist on the form | Done |
| 6 | Password hashing (bcrypt, never stored in plain text) | Done |
| 7 | **OTP via email** (SMTP/nodemailer) and **OTP via SMS** (Twilio) with resend + 60s cooldown + max 3 sends + 10 min expiry | Done |
| 8 | OTP codes stored as **SHA-256 hashes** (never plaintext) | Done |
| 9 | Verification page with 6-digit input boxes and countdown timer | Done |
| 10 | Login with email **or** mobile + password; auto-sends OTP if account not yet verified | Done |
| 11 | Login brute-force lockout (5 failed attempts = locked 15 min) | Done |
| 12 | Session-based auth, protected `/dashboard`, logout | Done |
| 13 | **Supabase support** — unified data layer that auto-switches between SQLite and Supabase; auto-probes keys at startup and uses the one the project accepts | Done |
| 14 | `supabase/schema.sql` — ready-to-run table creation script (+ RLS policies) | Done |
| 15 | **Supabase connected & verified** — live project, secret key accepted, E2E flow passed against real DB | Done |

**Verified by an end-to-end automated test** (register → captcha → OTP → verify → login → wrong-password rejection → weak-password rejection). All passed.

## 3. How the flow works

```
1. User registers  ->  first name, last name, email/mobile, captcha, strong password
2. Server validates:  name, email/mobile format, captcha, password rules
3. Account created (bcrypt hash) -> OTP generated and sent to email or SMS
4. User enters 6-digit OTP on /verify -> verified = true
5. User logs in -> session created -> /dashboard
   (login with an unverified account re-sends OTP automatically)
```

## 4. Tech stack

- **Node.js** (Express, express-session, bcryptjs, nodemailer)
- **Database:** Supabase (Postgres) — auto fallback to SQLite (`auth.db`) when Supabase keys are empty
- **Storage of login details:** `users` table (name, email, mobile, password hash, verified), `otps` table, `login_attempts` table

## 5. VALUES YOU MUST PROVIDE (I need these from you)

Fill these into the **`.env`** file. Copy `.env.example` and fill in:

| Variable | Where to get it | Needed for |
|----------|----------------|------------|
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL (format: `https://xxxx.supabase.co`) | Database connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → `service_role` key (**secret**, keep it server-side only) | Database writes/reads |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Your email provider (e.g. Gmail app password) | Sending OTP by **email** |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio console | Sending OTP by **SMS** |
| `SESSION_SECRET` | Any long random string | Session encryption (already set) |

> Until you provide Supabase keys, the app uses SQLite (`auth.db`) so you can test everything locally. OTPs are printed to the server console when SMTP/Twilio are not configured.

## 6. How to connect Supabase (3 steps)

1. Create a free project at [supabase.com](https://supabase.com) (or use existing).
2. Open **SQL Editor** → paste the contents of **`supabase/schema.sql`** → Run. This creates `users`, `otps`, `login_attempts` tables (+ RLS policies so the API keys can read/write).
3. Copy the Project URL + `secret` key into `.env` → restart the server.

> ✅ **Current status: SUPABASE IS CONNECTED AND VERIFIED.** Project `fjwvrrvyisatbjsjfcok`, secret key accepted (`sb_secret_...`), tables created, and a full end-to-end test (register → OTP → verify → login) passed against Supabase.

The app detects Supabase automatically when `SUPABASE_URL` and a key are filled. At startup it probes all configured keys and uses whichever one the project actually accepts (you'll see `Database: Supabase (key accepted: secret)` in the startup log).

## 7. Run the app

```bash
npm install
npm start            # http://localhost:3000
# Pages: /login  /register  /verify  /dashboard

# Global access from any device (Cloudflare quick tunnel, no account needed):
npm run tunnel       # prints a public URL like https://xxx.trycloudflare.com
# NOTE: quick-tunnel URLs change on every restart. For a permanent URL,
# deploy the app (Render/Railway/Fly.io/VPS) or use a named Cloudflare tunnel.
```

> ✅ **Current status: global access verified.** A public Cloudflare tunnel was tested — the login page and API responded correctly over the internet.

## 8. API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/captcha` | Get a captcha challenge |
| POST | `/api/register` | Create account + send OTP |
| POST | `/api/verify-otp` | Verify the 6-digit code |
| POST | `/api/resend-otp` | Resend OTP (60s cooldown) |
| POST | `/api/login` | Login (sends OTP if unverified) |
| POST | `/api/logout` | End session |
| GET | `/api/me` | Current logged-in user |

## 9. Not done yet / possible next steps

- Google reCAPTCHA / hCaptcha instead of (or in addition to) math captcha
- "Forgot password" + password reset via OTP
- Email verification resend link handling (already partially there via `/api/resend-otp`)
- Rate limiting per-IP (currently per-email/mobile)
- Frontend framework (React) or Tailwind styling upgrade
- Two-factor (TOTP app) as an extra factor