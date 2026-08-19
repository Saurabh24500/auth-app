require('dotenv').config();
const { buildTransporter, sendOtpEmail, sendWelcomeEmail, status } = require('../mailer');

(async () => {
  console.log('Building mail transport...');
  await buildTransporter();
  const s = status();
  console.log('Mailer status:', JSON.stringify({ configured: s.configured, host: s.host, usingPreview: s.usingPreview }));

  const to = process.argv[2] || 'test-recipient@example.com';
  console.log(`\nSending OTP email to ${to}...`);
  const r1 = await sendOtpEmail(to, '123456', 'Test User', 'signup');
  console.log('OTP result:', r1);

  console.log(`\nSending welcome email to ${to}...`);
  const r2 = await sendWelcomeEmail(to, 'Test User');
  console.log('Welcome result:', r2);

  const final = status();
  if (final.usingPreview && final.lastPreviewUrl) {
    console.log('\nOPEN EMAIL PREVIEW:', final.lastPreviewUrl);
  }
  if (r1 === 'console' && r2 === 'console') {
    console.log('\nNo transporter active - emails were logged to console only.');
    process.exit(1);
  }
})();
