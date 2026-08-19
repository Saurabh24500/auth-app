const nodemailer = require('nodemailer');

const isProd = process.env.NODE_ENV === 'production';

let transporter = null;
let usingPreview = false;      // true when delivering to an Ethereal test inbox
let configuredHost = null;     // real SMTP host if configured
let lastPreviewUrl = null;
let lastError = null;

function buildRealConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  };
}

async function buildTransporter() {
  transporter = null;
  usingPreview = false;
  lastError = null;

  if (process.env.SMTP_HOST) {
    configuredHost = process.env.SMTP_HOST;
    transporter = nodemailer.createTransport(buildRealConfig());
    try {
      await transporter.verify();
      console.log(`[SMTP] Connected to ${configuredHost}`);
      return;
    } catch (err) {
      lastError = err.message;
      console.error(`[SMTP] Real SMTP (${configuredHost}) verify failed:`, err.message);
      transporter = null;
      if (isProd) {
        console.error('[SMTP] Production SMTP failed - emails will NOT be delivered until fixed.');
        return;
      }
    }
  }

  // Non-production fallback: Ethereal preview inbox so the email flow is fully testable.
  // (Intentionally disabled in production — there, a missing/broken SMTP must surface
  // as an error rather than silently capturing mail to an unreachable preview.)
  if (!isProd) {
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      usingPreview = true;
      console.log('[SMTP] Using Ethereal preview account - emails are captured (not delivered to real inboxes).');
    } catch (err) {
      lastError = err.message;
      console.error('[SMTP] Could not create preview account:', err.message);
      transporter = null;
    }
  }
}

function resolveFrom() {
  if (usingPreview) return 'Auth App <no-reply@auth-app.dev>';
  return process.env.EMAIL_FROM || `Auth App <${process.env.SMTP_USER || 'no-reply@auth-app.dev'}>`;
}

async function sendMail(message) {
  message.from = message.from || resolveFrom();

  if (!transporter) {
    console.log(`\n[EMAIL] No active transporter. Would send to ${message.to}:\n${message.text || ''}\n`);
    return 'console';
  }

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const info = await transporter.sendMail(message);
      if (usingPreview) {
        lastPreviewUrl = nodemailer.getTestMessageUrl(info);
        console.log(`[EMAIL] Preview delivered to ${message.to} -> ${lastPreviewUrl}`);
      } else {
        console.log(`[EMAIL] Sent to ${message.to} (${info.messageId})`);
      }
      return usingPreview ? 'preview' : 'email';
    } catch (err) {
      lastErr = err;
      console.error(`[EMAIL] Attempt ${attempt} failed:`, err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  console.error('[EMAIL] Giving up after retries:', lastErr && lastErr.message);
  console.log(`\n[EMAIL] Fallback log - To: ${message.to}\n${message.text || ''}\n`);
  return 'console';
}

/* ----------------------------- Templates ----------------------------- */

function layout({ title, preheader, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader || ''}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:22px 28px">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.3px">Auth App</span>
        </td></tr>
        <tr><td style="padding:28px">
          ${body}
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eef0f3;color:#9ca3af;font-size:12px;line-height:1.6">
          You received this email because you have an account with Auth App.<br/>
          If you did not expect this, you can safely ignore it. &copy; ${new Date().getFullYear()} Auth App.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function otpHtml({ name, otp, purpose }) {
  const heading = purpose === 'reset' ? 'Reset your password' : 'Verify your email';
  const intro = purpose === 'reset'
    ? 'Use the code below to choose a new password. If you did not request this, you can ignore this email.'
    : 'Thanks for signing up! Use the code below to finish setting up your account.';
  return layout({
    title: heading,
    preheader: `Your verification code is ${otp}`,
    body: `
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Hello ${name || 'there'},</h2>
      <p style="margin:0 0 18px;color:#4b5563;line-height:1.6;font-size:15px">${intro}</p>
      <div style="background:#f3f4ff;border:1px dashed #c7d2fe;border-radius:12px;padding:18px;text-align:center">
        <div style="font-size:13px;color:#6b7280;letter-spacing:1px;text-transform:uppercase">Your code</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#4338ca;margin-top:6px">${otp}</div>
      </div>
      <p style="margin:18px 0 0;color:#9ca3af;font-size:13px">This code expires in 10 minutes. Never share it with anyone.</p>`,
  });
}

function welcomeHtml({ name }) {
  return layout({
    title: 'Welcome to Auth App',
    preheader: 'Your account is verified and ready to use.',
    body: `
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">You're all set, ${name || 'there'}!</h2>
      <p style="margin:0 0 16px;color:#4b5563;line-height:1.6;font-size:15px">
        Your email has been verified and your account is now active. You can log in and start using Auth App right away.
      </p>
      <a href="${process.env.APP_URL || 'http://localhost:3000/login'}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;font-size:15px">Go to login</a>
      <p style="margin:18px 0 0;color:#9ca3af;font-size:13px">Tip: enable a strong, unique password and never reuse it elsewhere.</p>`,
  });
}

function otpText({ name, otp, purpose }) {
  const intro = purpose === 'reset'
    ? 'Use this code to reset your password:'
    : 'Use this code to verify your email:';
  return `Hello ${name || 'there'},\n\n${intro}\n\n  ${otp}\n\nThis code expires in 10 minutes. If you did not request this, ignore the email.`;
}

function welcomeText({ name }) {
  return `Hello ${name || 'there'},\n\nYour account is verified and ready to use. You can now log in to Auth App.\n\nThanks,\nThe Auth App team`;
}

/* ----------------------------- Public API ----------------------------- */

async function sendOtpEmail(to, otp, name, purpose = 'signup') {
  const html = otpHtml({ name, otp, purpose });
  const text = otpText({ name, otp, purpose });
  const subject = purpose === 'reset' ? 'Reset your Auth App password' : 'Your Auth App verification code';
  const result = await sendMail({ to, subject, html, text });
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[EMAIL][dev] OTP for ${to}: ${otp} (channel=${result})`);
  }
  return result;
}

async function sendWelcomeEmail(to, name) {
  return sendMail({
    to,
    subject: 'Welcome to Auth App',
    html: welcomeHtml({ name }),
    text: welcomeText({ name }),
  });
}

function status() {
  return {
    configured: !!configuredHost,
    host: configuredHost,
    usingPreview,
    lastPreviewUrl,
    lastError,
  };
}

module.exports = {
  buildTransporter,
  sendOtpEmail,
  sendWelcomeEmail,
  status,
  getLastPreviewUrl: () => lastPreviewUrl,
  isUsingPreview: () => usingPreview,
};
