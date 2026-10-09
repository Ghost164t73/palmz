require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const Product = require('./models/Product');
const Customer = require('./models/Customer');
const Order = require('./models/Order');

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
const uploadProductImages = upload.fields([
  { name: 'images', maxCount: 12 },
  { name: 'image', maxCount: 1 },
]);
const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: 'palmz', resource_type: 'image' }, (err, result) => (err ? reject(err) : resolve(result)))
      .end(buffer);
  });
const removeFromCloudinary = (publicId) => (publicId ? cloudinary.uploader.destroy(publicId).catch(() => {}) : null);
function productImageFiles(req) {
  const fields = req.files || {};
  const files = [...(fields.images || []), ...(fields.image || [])];
  if (files.length > 12) throw bad('Choose no more than 12 product photos');
  if (files.reduce((total, file) => total + file.size, 0) > 4 * 1024 * 1024) {
    throw bad('Product photos must total no more than 4MB');
  }
  return files;
}
async function uploadProductGallery(files) {
  const images = [];
  try {
    for (const file of files) {
      const img = await uploadToCloudinary(file.buffer);
      images.push({ url: img.secure_url, publicId: img.public_id });
    }
    return images;
  } catch (err) {
    await Promise.all(images.map((image) => removeFromCloudinary(image.publicId)));
    throw err;
  }
}
function productImagePublicIds(product) {
  return [...new Set([
    product.image && product.image.publicId,
    ...(product.images || []).map((image) => image.publicId),
  ].filter(Boolean))];
}

// ---------- Admin auth (single password, signed cookie) ----------
const COOKIE = 'palmz_admin';
const CUSTOMER_COOKIE = 'palmz_customer';
const readCookie = (req) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
};
const readCustomerCookie = (req) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + CUSTOMER_COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
};
const googleClient = new OAuth2Client();
function requireAdmin(req, res, next) {
  try {
    const claims = jwt.verify(readCookie(req) || '', process.env.JWT_SECRET || '');
    if (typeof claims !== 'object' || claims.admin !== true) return res.status(401).json({ error: 'Not signed in' });
    next();
  } catch {
    res.status(401).json({ error: 'Not signed in' });
  }
}
function requireCustomer(req, res, next) {
  try {
    const claims = jwt.verify(readCustomerCookie(req) || '', process.env.JWT_SECRET || '');
    if (typeof claims !== 'object' || claims.scope !== 'customer' || !mongoose.isValidObjectId(claims.customer)) {
      return res.status(401).json({ error: 'Please sign in with Google' });
    }
    req.customerId = claims.customer;
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in with Google' });
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

// ---------- Customer auth ----------
const customerLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
app.get('/api/customer/google-config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || '' });
});
app.post('/api/customer/google', customerLoginLimiter, async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.JWT_SECRET) {
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
  const token = jwt.sign({ customer: String(customer._id), scope: 'customer' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${CUSTOMER_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}`);
  res.json({ customer });
});
app.get('/api/customer/me', requireCustomer, async (req, res) => {
  const customer = await Customer.findById(req.customerId);
  if (!customer) return res.status(401).json({ error: 'Please sign in with Google' });
  res.json({ customer });
});
app.post('/api/customer/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${CUSTOMER_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});
app.get('/api/customer/orders', requireCustomer, async (req, res) => {
  const orders = await Order.find({ customer: req.customerId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ orders });
});
const guestOrderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
async function orderContact(body, account = null) {
  const customerName = String(body.customerName || (account && account.name) || '').trim();
  const email = String((account && account.email) || body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const address = String(body.address || '').trim();
  const city = String(body.city || '').trim();
  const note = String(body.note || '').trim();
  if (!customerName || customerName.length > 80) throw bad('Enter a name of 1 to 80 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw bad('Enter a valid email address');
  if (!phone || phone.length > 40) throw bad('Enter a phone number of 1 to 40 characters');
  if (!address || address.length > 300) throw bad('Enter a delivery address of 1 to 300 characters');
  if (!city || city.length > 120) throw bad('Enter a city and state of 1 to 120 characters');
  if (note.length > 500) throw bad('Order note must be 500 characters or fewer');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    throw bad('An order must contain between 1 and 50 items');
  }
  if (body.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw bad('An item in your bag is invalid');
  }
  const productIds = [...new Set(body.items.map((item) => String(item.productId || '')))];
  if (productIds.some((id) => !mongoose.isValidObjectId(id))) throw bad('An item in your bag is no longer available');
  const products = await Product.find({ _id: { $in: productIds } });
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const quantities = new Map();
  const items = body.items.map((item) => {
    const productId = String(item.productId);
    const product = productsById.get(productId);
    const quantity = Number(item.quantity);
    const size = String(item.size || '');
    const color = String(item.color || '');
    if (!product || !product.inStock || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw bad('An item in your bag is no longer available');
    }
    if (!product.sizes.includes(size) || !product.colors.includes(color)) {
      throw bad('A size or colour in your bag is no longer available');
    }
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
    return {
      productId,
      name: product.name,
      size,
      color,
      quantity,
      unitPrice: product.price,
    };
  });
  for (const [productId, quantity] of quantities) {
    if (quantity > productsById.get(productId).quantity) throw bad('There is not enough stock for an item in your bag');
  }

  return {
    ...(account ? { customer: account._id, source: 'account' } : { source: 'guest' }),
    customerName,
    email,
    phone,
    address,
    city,
    note,
    items,
    paymentProvider: 'whatsapp',
    paymentStatus: 'not_started',
  };
}
app.post('/api/orders', guestOrderLimiter, async (req, res) => {
  const order = await Order.create(await orderContact(req.body || {}));
  res.status(201).json({ order: { id: String(order._id), status: order.status } });
});
app.post('/api/customer/orders', requireCustomer, async (req, res) => {
  const customer = await Customer.findById(req.customerId);
  if (!customer) return res.status(401).json({ error: 'Please sign in with Google' });
  const order = await Order.create(await orderContact(req.body || {}, customer));
  res.status(201).json({ order });
});

// ---------- Admin order management ----------
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const filter = {};
  if (req.query.status && req.query.status !== 'all') {
    if (!Order.ORDER_STATUSES.includes(req.query.status)) throw bad('Unknown order status');
    filter.status = req.query.status;
  }
  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ orders, statuses: Order.ORDER_STATUSES });
});
app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const status = req.body && req.body.status;
  if (!Order.ORDER_STATUSES.includes(status)) throw bad('Choose a valid order status');
  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { $set: { status } },
    { new: true, runValidators: true }
  ).lean();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

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
function validId(req, res, next) {
  return mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ error: 'Product not found' });
}

// ---------- Public API ----------
app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: 1 });
  res.set('Cache-Control', 'no-store');
  res.json({ products, whatsapp: process.env.WHATSAPP_NUMBER || '' });
});

// ---------- Admin API ----------
app.post('/api/admin/products', requireAdmin, uploadProductImages, async (req, res) => {
  const data = readFields(req.body);
  const files = productImageFiles(req);
  if (!files.length) throw bad('Please choose at least one product image');
  const images = await uploadProductGallery(files);
  try {
    const p = await Product.create({ ...data, image: images[0], images });
    res.status(201).json(p);
  } catch (e) {
    await Promise.all(images.map((image) => removeFromCloudinary(image.publicId)));
    throw e;
  }
});

app.put('/api/admin/products/:id', requireAdmin, validId, uploadProductImages, async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const data = readFields(req.body);
  const files = productImageFiles(req);
  const oldIds = productImagePublicIds(p);
  if (files.length) {
    const images = await uploadProductGallery(files);
    data.image = images[0];
    data.images = images;
    p.set(data);
    try {
      await p.save();
    } catch (err) {
      await Promise.all(images.map((image) => removeFromCloudinary(image.publicId)));
      throw err;
    }
    await Promise.all(oldIds.map(removeFromCloudinary));
  } else {
    p.set(data);
    await p.save();
  }
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
  await Promise.all(productImagePublicIds(p).map(removeFromCloudinary));
  res.json({ ok: true });
});

// ---------- Pages ----------
const pub = path.join(__dirname, 'public');
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/admin/orders', (req, res) => res.sendFile(path.join(pub, 'orders.html')));
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
