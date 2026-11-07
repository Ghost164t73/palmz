const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { COOKIE } = require('../config/constants');
const { productionAuthConfigReady, sha } = require('../middleware/auth');

// POST /api/admin/login
const login = (req, res) => {
  if (!process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET || !productionAuthConfigReady()) {
    return res.status(500).json({ error: 'Set ADMIN_PASSWORD and JWT_SECRET; in production use a 16-character admin password and a JWT_SECRET of at least 32 bytes' });
  }
  if (!crypto.timingSafeEqual(sha(req.body.password || ''), sha(process.env.ADMIN_PASSWORD))) return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict${secure}`);
  res.json({ ok: true });
};

// POST /api/admin/logout
const logout = (req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${secure}`);
  res.json({ ok: true });
};

// GET /api/admin/me
const me = (req, res) => res.json({ ok: true });

module.exports = {
  login,
  logout,
  me,
};
