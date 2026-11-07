const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { COOKIE, CUSTOMER_COOKIE } = require('../config/constants');

function productionAuthConfigReady() {
  return process.env.NODE_ENV !== 'production' || (
    Buffer.byteLength(process.env.JWT_SECRET || '', 'utf8') >= 32 &&
    Buffer.byteLength(process.env.ADMIN_PASSWORD || '', 'utf8') >= 16
  );
}

const readCookie = (req) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
};

const readCustomerCookie = (req) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + CUSTOMER_COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
};

function requireAdmin(req, res, next) {
  if (!productionAuthConfigReady()) return res.status(503).json({ error: 'Production authentication secrets are not securely configured' });
  try {
    const claims = jwt.verify(readCookie(req) || '', process.env.JWT_SECRET || '');
    if (typeof claims !== 'object' || claims.admin !== true) return res.status(401).json({ error: 'Not signed in' });
    next();
  } catch {
    res.status(401).json({ error: 'Not signed in' });
  }
}

function requireAdminPage(req, res, next) {
  if (!productionAuthConfigReady()) return res.redirect('/admin');
  try {
    const claims = jwt.verify(readCookie(req) || '', process.env.JWT_SECRET || '');
    if (typeof claims === 'object' && claims.admin === true) return next();
  } catch {}
  const page = String(req.path || '').split('/').filter(Boolean).pop() || '';
  const allowedPages = new Set(['orders', 'sales', 'promos', 'users', 'delivery']);
  const pageKey = page.replace(/\.html$/i, '');
  return res.redirect(`/admin?next=${allowedPages.has(pageKey) ? encodeURIComponent(pageKey) : ''}`);
}

function requireCustomer(req, res, next) {
  if (!productionAuthConfigReady()) return res.status(503).json({ error: 'Production authentication secrets are not securely configured' });
  try {
    const claims = jwt.verify(readCustomerCookie(req) || '', process.env.JWT_SECRET || '');
    if (typeof claims !== 'object' || claims.scope !== 'customer' || !mongoose.isValidObjectId(claims.customer)) {
      return res.status(401).json({ error: 'Please sign in' });
    }
    req.customerId = claims.customer;
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in' });
  }
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

function setCustomerCookie(res, customer) {
  const token = jwt.sign({ customer: String(customer._id), scope: 'customer' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${CUSTOMER_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}`);
}

function authConfigError(res) {
  if (!process.env.JWT_SECRET || !productionAuthConfigReady()) {
    res.status(503).json({ error: 'Sign-in is not configured yet' });
    return true;
  }
  return false;
}

function optionalCustomerId(req) {
  try {
    const claims = jwt.verify(readCustomerCookie(req) || '', process.env.JWT_SECRET || '');
    return claims && claims.scope === 'customer' && mongoose.isValidObjectId(claims.customer) ? claims.customer : null;
  } catch {
    return null;
  }
}

module.exports = {
  productionAuthConfigReady,
  readCookie,
  readCustomerCookie,
  requireAdmin,
  requireAdminPage,
  requireCustomer,
  sha,
  setCustomerCookie,
  authConfigError,
  optionalCustomerId,
};
