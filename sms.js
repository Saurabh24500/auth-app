async function sendOtpSms(to, otp) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (sid && token && from) {
    const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
    const body = new URLSearchParams({ To: to, From: from, Body: `Your verification code is ${otp}. It expires in 10 minutes.` });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Twilio error: ${res.status} ${err}`);
    }
    return 'sms';
  }

  console.log(`\n[SMS OTP] To: ${to} | Code: ${otp}\n`);
  return 'console';
}

module.exports = { sendOtpSms };
