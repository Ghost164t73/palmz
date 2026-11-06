const crypto = require('crypto');

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    // Run a dummy hash so missing accounts take about as long as wrong passwords.
    await scrypt(String(password), Buffer.alloc(16));
    return false;
  }
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const actual = await scrypt(String(password), salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateSignup({ name, email, password }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = normalizeEmail(email);
  const pwd = typeof password === 'string' ? password : '';
  if (!cleanName || cleanName.length > 80) return { error: 'Enter your name (1 to 80 characters)' };
  if (!EMAIL_PATTERN.test(cleanEmail) || cleanEmail.length > 254) return { error: 'Enter a valid email address' };
  if (pwd.length < 8) return { error: 'Password must be at least 8 characters' };
  if (pwd.length > 128) return { error: 'Password must be 128 characters or fewer' };
  if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return { error: 'Password must include at least one letter and one number' };
  return { name: cleanName, email: cleanEmail, password: pwd };
}

module.exports = { hashPassword, verifyPassword, normalizeEmail, validateSignup, EMAIL_PATTERN };
