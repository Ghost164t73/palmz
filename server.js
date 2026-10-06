require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Product = require('./models/Product');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// ---------- MongoDB (cached so it works on serverless hosts like Vercel) ----------
let cached = global._palmzMongo || (global._palmzMongo = { conn: null, promise: null });
async function connectDb() {
  if (cached.conn) return cached.conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  cached.promise = cached.promise || mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}
app.use('/api', async (req, res, next) => {
  try {
    await connectDb();
    next();
  } catch (e) {
    console.error('DB connection failed:', e.message);
    res.status(500).json({ error: 'Database connection failed. Check MONGODB_URI.' });
  }
});

// ---------- Image upload: multer (memory) -> Cloudinary ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB (Vercel's request body limit is ~4.5MB)
  fileFilter(req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only JPG, PNG or WebP images are allowed'), { status: 400, expose: true }));
  },
});
const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: 'palmz', resource_type: 'image' }, (err, result) => (err ? reject(err) : resolve(result)))
      .end(buffer);
  });
const removeFromCloudinary = (publicId) => (publicId ? cloudinary.uploader.destroy(publicId).catch(() => {}) : null);

// ---------- Admin auth (single password, signed cookie) ----------
const COOKIE = 'palmz_admin';
const readCookie = (req) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
};
function requireAdmin(req, res, next) {
  try {
    jwt.verify(readCookie(req) || '', process.env.JWT_SECRET || '');
    next();
  } catch {
    res.status(401).json({ error: 'Not signed in' });
  }
}
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) return res.status(500).json({ error: 'ADMIN_PASSWORD and JWT_SECRET must be set on the server' });
  if (!crypto.timingSafeEqual(sha(req.body.password || ''), sha(process.env.ADMIN_PASSWORD))) return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict${secure}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`);
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

// ---------- Validation ----------
const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });
function int(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}
function readFields(b) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('Name is required');
  const sizeMin = int(b.sizeMin, 20, 60, 'Smallest size');
  const sizeMax = int(b.sizeMax, 20, 60, 'Largest size');
  if (sizeMin > sizeMax) throw bad('Smallest size cannot be bigger than the largest size');
  let price = null;
  if (String(b.price ?? '').trim() !== '') {
    price = Number(b.price);
    if (!(price >= 0)) throw bad('Price must be a positive number (or leave it empty)');
  }
  const colors = String(b.colors || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  return {
    name,
    type: String(b.type || '').trim() || 'Palm',
    desc: String(b.desc || '').trim(),
    colors: colors.length ? colors : ['Standard'],
    price,
    sizeMin,
    sizeMax,
    quantity: int(b.quantity, 0, 100000, 'Quantity'),
    available: b.available === true || b.available === 'true',
  };
}
const validId = (req, res, next) => (mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ error: 'Product not found' }));

// ---------- Public API ----------
app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: 1 });
  res.set('Cache-Control', 'no-store');
  res.json({ products, whatsapp: process.env.WHATSAPP_NUMBER || '' });
});

// ---------- Admin API ----------
app.post('/api/admin/products', requireAdmin, upload.single('image'), async (req, res) => {
  const data = readFields(req.body);
  if (!req.file) throw bad('Please choose a product image');
  const img = await uploadToCloudinary(req.file.buffer);
  try {
    const p = await Product.create({ ...data, image: { url: img.secure_url, publicId: img.public_id } });
    res.status(201).json(p);
  } catch (e) {
    await removeFromCloudinary(img.public_id);
    throw e;
  }
});

app.put('/api/admin/products/:id', requireAdmin, validId, upload.single('image'), async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const data = readFields(req.body);
  let oldId = null;
  if (req.file) {
    const img = await uploadToCloudinary(req.file.buffer);
    oldId = p.image && p.image.publicId;
    data.image = { url: img.secure_url, publicId: img.public_id };
  }
  p.set(data);
  await p.save();
  await removeFromCloudinary(oldId);
  res.json(p);
});

// quick stock edits: { quantity } or { delta } and/or { available }
app.patch('/api/admin/products/:id/stock', requireAdmin, validId, async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const b = req.body || {};
  if (b.quantity !== undefined) p.quantity = int(b.quantity, 0, 100000, 'Quantity');
  if (b.delta !== undefined) p.quantity = Math.max(0, p.quantity + int(b.delta, -1000, 1000, 'Change'));
  if (b.available !== undefined) p.available = b.available === true || b.available === 'true';
  await p.save();
  res.json(p);
});

app.delete('/api/admin/products/:id', requireAdmin, validId, async (req, res) => {
  const p = await Product.findByIdAndDelete(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  await removeFromCloudinary(p.image && p.image.publicId);
  res.json({ ok: true });
});

// ---------- Pages ----------
const pub = path.join(__dirname, 'public');
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.use(express.static(pub));

// Express 4 doesn't catch rejected promises by itself, so wrap async routes
for (const layer of app._router.stack) {
  if (layer.route) {
    for (const l of layer.route.stack) {
      const fn = l.handle;
      if (fn.constructor.name === 'AsyncFunction') l.handle = (req, res, next) => fn(req, res, next).catch(next);
    }
  }
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 4MB' : err.message });
  if (err.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join(', ') });
  if (!err.expose) console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong' });
});

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`PALMZ running on http://localhost:${port}  (admin: /admin)`));
}
