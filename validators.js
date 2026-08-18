const dns = require('node:dns').promises;

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MOBILE_RE = /^\+?[0-9]{7,15}$/;
const SPECIAL_CHARS = /[^A-Za-z0-9]/;

function validateName(value, field) {
  if (typeof value !== 'string' || value.trim().length < 2) {
    return `${field} must be at least 2 characters.`;
  }
  if (value.trim().length > 50) {
    return `${field} must be at most 50 characters.`;
  }
  if (!/^[A-Za-z' -]+$/.test(value.trim())) {
    return `${field} can only contain letters, spaces, apostrophes and hyphens.`;
  }
  return null;
}

function validateEmail(value) {
  const email = (value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return 'Enter a valid email address.';
  }
  return { email };
}

async function emailDomainHasMailServer(email) {
  try {
    const domain = email.split('@')[1];
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return null;
  }
}

function validateMobile(value) {
  const mobile = (value || '').trim().replace(/[\s()-]/g, '');
  if (!MOBILE_RE.test(mobile)) {
    return 'Enter a valid mobile number (7-15 digits, optional leading +).';
  }
  return { mobile };
}

function validatePassword(value) {
  const password = value || '';
  if (password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter (A-Z).';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter (a-z).';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one digit (0-9).';
  }
  if (!SPECIAL_CHARS.test(password)) {
    return 'Password must include at least one special character (e.g. !@#$%).';
  }
  if (password.length > 128) {
    return 'Password must be at most 128 characters.';
  }
  return null;
}

function maskIdentifier(value) {
  const s = (value || '').trim();
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    return `${local[0]}***${local.slice(-1)}@${domain}`;
  }
  return s.length <= 4 ? '***' : s.slice(0, 2) + '***' + s.slice(-2);
}

module.exports = {
  validateName,
  validateEmail,
  validateMobile,
  validatePassword,
  emailDomainHasMailServer,
  maskIdentifier,
};
