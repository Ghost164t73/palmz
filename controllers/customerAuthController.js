const Customer = require('../models/Customer');
const { hashPassword, normalizeEmail, validateSignup, verifyPassword } = require('../lib/password');
const { CUSTOMER_COOKIE } = require('../config/constants');
const { authConfigError, productionAuthConfigReady, setCustomerCookie } = require('../middleware/auth');
const { ensureCustomerIndexes, googleClient } = require('../services/customers');

// GET /api/customer/google-config
const googleConfig = (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || '' });
};

// POST /api/customer/google
const googleSignIn = async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.JWT_SECRET || !productionAuthConfigReady()) {
    return res.status(503).json({ error: 'Google sign-in is not configured yet' });
  }
  const credential = req.body && typeof req.body.credential === 'string' ? req.body.credential : '';
  if (!credential) return res.status(400).json({ error: 'Google sign-in credential is required' });

  let profile;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    profile = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }
  if (!profile || !profile.sub || !profile.email || profile.email_verified !== true) {
    return res.status(401).json({ error: 'Use a Google account with a verified email address' });
  }

  // Link Google to an existing email/password account with the same verified email.
  if (!(await Customer.exists({ googleId: profile.sub }))) {
    await ensureCustomerIndexes();
    await Customer.updateOne(
      { email: String(profile.email).toLowerCase(), googleId: { $exists: false } },
      { $set: { googleId: profile.sub } }
    );
  }
  const customer = await Customer.findOneAndUpdate(
    { googleId: profile.sub },
    {
      $set: {
        name: String(profile.name || profile.email).slice(0, 80),
        email: profile.email,
        picture: profile.picture || '',
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  setCustomerCookie(res, customer);
  res.json({ customer });
};

// POST /api/customer/signup
const signup = async (req, res) => {
  if (authConfigError(res)) return;
  const input = validateSignup(req.body || {});
  if (input.error) return res.status(400).json({ error: input.error });
  await ensureCustomerIndexes();
  const existing = await Customer.findOne({ email: input.email }).select('+passwordHash googleId');
  if (existing) {
    return res.status(409).json({
      error: existing.passwordHash
        ? 'An account with this email already exists. Please sign in instead.'
        : 'This email is linked to Google. Please use Continue with Google.',
    });
  }
  const customer = await Customer.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
  });
  setCustomerCookie(res, customer);
  res.status(201).json({ customer });
};

// POST /api/customer/login
const login = async (req, res) => {
  if (authConfigError(res)) return;
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password || password.length > 128) return res.status(400).json({ error: 'Enter your email and password' });
  const customer = await Customer.findOne({ email, passwordHash: { $exists: true } }).select('+passwordHash');
  const ok = await verifyPassword(password, customer && customer.passwordHash);
  if (!customer || !ok) {
    const googleOnly = !customer && await Customer.exists({ email, googleId: { $exists: true } });
    return res.status(401).json({
      error: googleOnly ? 'This email is linked to Google. Please use Continue with Google.' : 'Incorrect email or password',
    });
  }
  setCustomerCookie(res, customer);
  res.json({ customer });
};

// GET /api/customer/me
const me = async (req, res) => {
  const customer = await Customer.findById(req.customerId);
  if (!customer) return res.status(401).json({ error: 'Please sign in' });
  res.json({ customer });
};

// POST /api/customer/logout
const logout = (req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${CUSTOMER_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
  res.json({ ok: true });
};

module.exports = {
  googleConfig,
  googleSignIn,
  signup,
  login,
  me,
  logout,
};
