const nodemailer = require('nodemailer');

let transporter = null;

if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendOtpEmail(to, otp, name) {
  const subject = 'Your verification code';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
      <h2 style="color:#1f2937;margin:0 0 8px">Hello ${name || 'there'}!</h2>
      <p style="color:#4b5563;line-height:1.6">Your one-time password is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#4338ca;text-align:center;margin:16px 0">${otp}</p>
      <p style="color:#9ca3af;font-size:13px">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p>
    </div>`;

  if (transporter) {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n[EMAIL OTP] To: ${to} | Code: ${otp}\n`);
    }
    return 'email';
  }

  console.log(`\n[EMAIL OTP] To: ${to} | Code: ${otp}\n`);
  return 'console';
}

module.exports = { sendOtpEmail };
