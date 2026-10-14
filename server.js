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
const { DELIVERY_TIERS, deliveryQuote, calculateOrderTotal } = require('./lib/delivery');
const {
  expectedPaymentAmountKobo,
  paystackTransactionMismatches,
  paymentAmountMismatchDetails,
} = require('./lib/paystack');

const PICKUP_BRANCHES = {
  'shop-1': { name: 'Shop 1', address: 'Genesis Plaza, NTA Roundabout', city: 'Lokoja, Kogi State', available: true },
  'shop-2': { name: 'Shop 2', address: 'Location to be confirmed', city: '', available: false },
  'shop-3': { name: 'Shop 3', address: 'Location to be confirmed', city: '', available: false },
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({
  limit: '100kb',
  verify(req, res, buffer) {
    if (req.originalUrl === '/api/paystack/webhook') req.rawBody = Buffer.from(buffer);
  },
}));
app.get('/delivery-options', (req, res) => res.json({ tiers: DELIVERY_TIERS }));

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
const paystackOrderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
function variantStockKey(color, size) {
  return `${encodeURIComponent(String(color)).replace(/\./g, '%2E')}__${String(size)}`;
}
function completeVariantStock(product) {
  const saved = product.stockByVariant;
  if (saved && saved.size) return saved;
  const colors = product.colors.length ? product.colors : ['Standard'];
  const sizes = product.sizes;
  const stock = new Map();
  const bySize = product.stockBySize;
  if (bySize && bySize.size) {
    sizes.forEach((size) => {
      const count = bySize.get(size) || 0;
      colors.forEach((color, index) => stock.set(variantStockKey(color, size), Math.floor(count / colors.length) + (index < count % colors.length ? 1 : 0)));
    });
  } else {
    const combinations = colors.length * sizes.length;
    const each = Math.floor(product.quantity / combinations), remainder = product.quantity % combinations;
    let index = 0;
    colors.forEach((color) => sizes.forEach((size) => stock.set(variantStockKey(color, size), each + (index++ < remainder ? 1 : 0))));
  }
  return stock;
}

async function orderContact(body, account = null, paymentProvider = 'whatsapp') {
  const customerName = String(body.customerName || (account && account.name) || '').trim();
  const email = String((account && account.email) || body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const fulfillmentMethod = String(body.fulfillmentMethod || 'delivery');
  let address = String(body.address || '').trim();
  let city = String(body.city || '').trim();
  let deliveryState = '';
  let deliveryFee = 0;
  let deliveryEstimate = '';
  let pickupBranch = null;
  const note = String(body.note || '').trim();
  if (!customerName || customerName.length > 80) throw bad('Enter a name of 1 to 80 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw bad('Enter a valid email address');
  if (!phone || phone.length > 40) throw bad('Enter a phone number of 1 to 40 characters');
  if (!['delivery', 'pickup'].includes(fulfillmentMethod)) throw bad('Choose delivery or branch pickup');
  if (fulfillmentMethod === 'pickup') {
    pickupBranch = PICKUP_BRANCHES[String(body.pickupBranchId || '')];
    if (!pickupBranch || !pickupBranch.available) throw bad('Choose an available pickup branch');
    address = `${pickupBranch.name}: ${pickupBranch.address}`;
    city = pickupBranch.city;
  } else {
    if (!address || address.length > 300) throw bad('Enter a delivery address of 1 to 300 characters');
    if (!city || city.length > 80) throw bad('Enter a city of 1 to 80 characters');
    deliveryState = String(body.state || '').trim();
    const quote = deliveryQuote(deliveryState, city);
    if (!quote) throw bad('Choose a valid delivery state');
    deliveryFee = quote.fee;
    deliveryEstimate = quote.estimate;
    city = `${city}, ${deliveryState}`;
  }
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
  const quantitiesByVariant = new Map();
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
    const variantKey = variantStockKey(color, size);
    const stockKey = `${productId}:${variantKey}`;
    quantitiesByVariant.set(stockKey, (quantitiesByVariant.get(stockKey) || 0) + quantity);
    if (completeVariantStock(product).get(variantKey) < quantitiesByVariant.get(stockKey)) throw bad(`There is not enough stock for ${color}, size ${size}`);
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
  const totalAmount = calculateOrderTotal(items, deliveryFee);
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
    fulfillmentMethod,
    deliveryState,
    deliveryFee,
    deliveryEstimate,
    totalAmount,
    pickupBranchId: pickupBranch ? String(body.pickupBranchId) : '',
    pickupBranchName: pickupBranch ? pickupBranch.name : '',
    pickupBranchAddress: pickupBranch ? pickupBranch.address : '',
    note,
    items,
    paymentProvider,
    paymentStatus: paymentProvider === 'paystack' ? 'pending' : 'not_started',
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

async function createPaystackOrder(req, account = null) {
  if (!process.env.PAYSTACK_SECRET_KEY || !process.env.APP_URL) {
    throw Object.assign(new Error('Online payment is not configured. Choose WhatsApp checkout or contact PALMZ.'), {
      status: 503,
      expose: true,
    });
  }
  if (process.env.NODE_ENV === 'production' && !process.env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
    throw Object.assign(new Error('Live Paystack payments require a live secret key. Update PAYSTACK_SECRET_KEY in the server environment.'), {
      status: 503,
      expose: true,
    });
  }
  let appUrl;
  try {
    appUrl = new URL(process.env.APP_URL);
  } catch {
    throw Object.assign(new Error('Online payment is not configured correctly. Contact PALMZ.'), {
      status: 503,
      expose: true,
    });
  }
  if (!['https:', 'http:'].includes(appUrl.protocol) ||
      (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:')) {
    throw Object.assign(new Error('Online payment requires a valid secure APP_URL.'), {
      status: 503,
      expose: true,
    });
  }

  const orderData = await orderContact(req.body || {}, account, 'paystack');
  if (orderData.items.some((item) => item.unitPrice == null)) {
    throw bad('Online payment is unavailable for an item without a set price. Choose WhatsApp checkout instead.');
  }
  const amountKobo = Math.round(orderData.totalAmount * 100);
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 ||
      Math.abs(amountKobo / 100 - orderData.totalAmount) > 1e-7) {
    throw bad('The order total cannot be processed online. Choose WhatsApp checkout instead.');
  }

  const order = await Order.create({
    ...orderData,
    paymentAmountKobo: amountKobo,
  });
  const reference = `palmz-${order._id}-${crypto.randomBytes(8).toString('hex')}`;
  order.paystackReference = reference;
  await order.save();

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: order.email,
        amount: amountKobo,
        currency: 'NGN',
        reference,
        callback_url: new URL('/paystack/callback', appUrl).toString(),
        metadata: { orderId: String(order._id) },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.status !== true || !data.data?.authorization_url) {
      throw new Error(data && data.message ? data.message : 'Paystack did not return a checkout link');
    }
    const authorizationUrl = new URL(data.data.authorization_url);
    if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'checkout.paystack.com') {
      throw new Error('Paystack returned an invalid checkout URL');
    }
    return authorizationUrl.toString();
  } catch (error) {
    order.paymentStatus = 'failed';
    await order.save();
    console.error('Paystack initialization failed:', error.message);
    throw Object.assign(new Error('Could not start Paystack checkout. Please try again or choose WhatsApp checkout.'), {
      status: 502,
      expose: true,
    });
  }
}

app.post('/api/orders/paystack', guestOrderLimiter, paystackOrderLimiter, async (req, res) => {
  const authorizationUrl = await createPaystackOrder(req);
  res.status(201).json({ authorizationUrl });
});
app.post('/api/customer/orders/paystack', requireCustomer, paystackOrderLimiter, async (req, res) => {
  const customer = await Customer.findById(req.customerId);
  if (!customer) return res.status(401).json({ error: 'Please sign in with Google' });
  const authorizationUrl = await createPaystackOrder(req, customer);
  res.status(201).json({ authorizationUrl });
});

async function verifyPaystackTransaction(reference) {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  if (process.env.NODE_ENV === 'production' && !process.env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
    throw new Error('Live Paystack payment verification requires a live secret key');
  }
  const order = await Order.findOne({ paystackReference: reference });
  if (!order) throw new Error('Paystack reference does not match an order');
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') return order.paymentStatus;

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.status !== true || !result.data) {
    throw new Error(result && result.message ? result.message : 'Paystack could not verify the transaction');
  }
  const transaction = result.data;
  const mismatches = paystackTransactionMismatches(order, transaction, reference);
  if (mismatches.length) {
    const details = mismatches.includes('amount')
      ? paymentAmountMismatchDetails(order, transaction)
      : null;
    throw new Error(`Paystack transaction ${mismatches.join(', ')} did not match order ${order._id}${details ? ` (order requested ${details.expectedKobo} kobo, Paystack requested ${details.requestedKobo} kobo, customer charged ${details.receivedKobo} kobo)` : ''}`);
  }
  if (transaction.status === 'success') {
    order.paymentStatus = 'paid';
    order.paidAmountKobo = Number(transaction.amount);
    order.paystackFeeKobo = Number(transaction.amount) - expectedPaymentAmountKobo(order);
  }
  else if (['failed', 'abandoned'].includes(transaction.status)) order.paymentStatus = 'failed';
  await order.save();
  return order.paymentStatus;
}

app.get('/paystack/callback', async (req, res) => {
  const reference = typeof req.query.reference === 'string' ? req.query.reference : '';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(reference)) {
    return res.redirect('/checkout?payment=unverified');
  }
  try {
    await connectDb();
    const paymentStatus = await verifyPaystackTransaction(reference);
    if (paymentStatus === 'paid') {
      return res.redirect(`/checkout?payment=success&reference=${encodeURIComponent(reference)}`);
    }
    if (paymentStatus === 'failed') return res.redirect('/checkout?payment=failed');
    return res.redirect('/checkout?payment=pending');
  } catch (error) {
    console.error('Paystack callback verification failed:', error.message);
    return res.redirect('/checkout?payment=unverified');
  }
});

app.post('/api/paystack/webhook', async (req, res) => {
  const signature = req.get('x-paystack-signature') || '';
  const rawBody = req.rawBody;
  if (!process.env.PAYSTACK_SECRET_KEY || !rawBody ||
      !/^[a-f0-9]{128}$/i.test(signature)) {
    return res.status(401).json({ error: 'Invalid Paystack signature' });
  }
  if (process.env.NODE_ENV === 'production' && !process.env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
    return res.status(503).json({ error: 'Live Paystack webhook verification requires a live secret key' });
  }
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Invalid Paystack signature' });
  }
  if (!req.body || req.body.event !== 'charge.success') return res.json({ received: true });

  const transaction = req.body.data;
  if (!transaction || typeof transaction.reference !== 'string') {
    return res.status(400).json({ error: 'Invalid Paystack transaction' });
  }
  const order = await Order.findOne({ paystackReference: transaction.reference });
  if (!order) return res.json({ received: true });
  const mismatches = paystackTransactionMismatches(order, transaction, order.paystackReference);
  if (transaction.status !== 'success' || mismatches.length) {
    const details = mismatches.includes('amount')
      ? paymentAmountMismatchDetails(order, transaction)
      : null;
    console.error(`Paystack webhook transaction ${mismatches.join(', ') || 'status'} did not match order ${order._id}${details ? ` (order requested ${details.expectedKobo} kobo, Paystack requested ${details.requestedKobo} kobo, customer charged ${details.receivedKobo} kobo)` : ''}`);
    return res.status(400).json({ error: 'Paystack transaction does not match the order' });
  }
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded') {
    order.paymentStatus = 'paid';
    order.paidAmountKobo = Number(transaction.amount);
    order.paystackFeeKobo = Number(transaction.amount) - expectedPaymentAmountKobo(order);
    await order.save();
  }
  res.json({ received: true });
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
app.patch('/api/admin/orders/:id/payment', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.paymentProvider !== 'whatsapp') {
    throw bad('Manual payment recording is only available for WhatsApp orders');
  }
  if (order.paymentStatus === 'paid') throw bad('This order is already marked as paid');

  const rawAmount = req.body && req.body.amount;
  if (typeof rawAmount !== 'string' && typeof rawAmount !== 'number') {
    throw bad('Enter the received amount in naira, up to two decimal places');
  }
  const amount = Number(rawAmount);
  const amountKobo = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountKobo) ||
      Math.abs(amountKobo / 100 - amount) > 1e-7) {
    throw bad('Enter the received amount in naira, up to two decimal places');
  }
  if (order.totalAmount != null && amountKobo < Math.round(order.totalAmount * 100)) {
    throw bad('The received amount cannot be less than the order total');
  }
  const rawReference = req.body && req.body.reference;
  if (rawReference != null && typeof rawReference !== 'string') {
    throw bad('Payment reference must be text');
  }
  const paymentReference = String(rawReference || '').trim();
  if (paymentReference.length > 120) throw bad('Payment reference must be 120 characters or fewer');

  order.paymentStatus = 'paid';
  order.paidAmountKobo = amountKobo;
  order.paymentReference = paymentReference;
  await order.save();
  res.json({ order: order.toObject() });
});
app.get('/api/admin/sales', requireAdmin, async (req, res) => {
  const orders = await Order.find({
    $or: [
      { 'salesHistory.0': { $exists: true } },
      { status: { $in: ['confirmed', 'fulfilled'] } },
    ],
  }).sort({ createdAt: -1 }).select('customerName email status items salesHistory createdAt updatedAt').lean();
  const sales = [];
  for (const order of orders) {
    const events = order.salesHistory || [];
    const reversedBy = new Map(events.filter((event) => event.type === 'reversal').map((event) => [event.reverses, event]));
    const recordedSales = events.filter((event) => event.type === 'sale');
    recordedSales.forEach((event) => {
      const reversal = reversedBy.get(String(event._id));
      sales.push({
        id: String(event._id), orderId: String(order._id), customerName: order.customerName,
        email: order.email, status: order.status, soldAt: event.createdAt,
        items: event.items, reversed: Boolean(reversal), reversedAt: reversal && reversal.createdAt,
      });
    });
    if (!recordedSales.length && ['confirmed', 'fulfilled'].includes(order.status)) {
      sales.push({
        id: `legacy-${order._id}`, orderId: String(order._id), customerName: order.customerName,
        email: order.email, status: order.status, soldAt: order.updatedAt || order.createdAt,
        items: order.items, reversed: false, legacy: true,
      });
    }
  }
  sales.sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt));
  res.json({ sales });
});
app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const status = req.body && req.body.status;
  if (!Order.ORDER_STATUSES.includes(status)) throw bad('Choose a valid order status');
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const approved = ['confirmed', 'fulfilled'].includes(status);
  const applied = [];

  if (approved && !order.inventoryDeducted) {
    const grouped = new Map();
    for (const item of order.items) {
      const key = `${item.productId}:${variantStockKey(item.color, item.size)}`;
      const current = grouped.get(key) || { productId: item.productId, color: item.color, size: item.size, quantity: 0 };
      current.quantity += item.quantity;
      grouped.set(key, current);
    }
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, inventoryDeducted: { $ne: true } },
      { $set: { inventoryDeducted: true } },
      { new: true }
    );
    if (claimed) {
      order.inventoryDeducted = true;
      try {
        for (const item of grouped.values()) {
          const product = await Product.findById(item.productId);
          if (!product) throw bad(`Product "${item.productId}" in this order no longer exists`);
          const inventory = completeVariantStock(product);
          product.stockByVariant = inventory;
          product.stockBySize = {};
          product.quantity = [...inventory.values()].reduce((sum, count) => sum + count, 0);
          await product.save();
          const key = variantStockKey(item.color, item.size);
          const result = await Product.updateOne(
            { _id: product._id, [`stockByVariant.${key}`]: { $gte: item.quantity } },
            {
              $inc: { [`stockByVariant.${key}`]: -item.quantity, quantity: -item.quantity },
              $push: { stockHistory: { color: item.color, size: item.size, quantity: -item.quantity, reason: 'confirmed order' } },
            }
          );
          if (!result.modifiedCount) throw bad(`Not enough stock for ${product.name}, ${item.color}, size ${item.size}`);
          applied.push({ productId: product._id, color: item.color, size: item.size, key, quantity: item.quantity });
        }
        order.salesHistory.push({
          type: 'sale',
          status,
          items: order.items.map((item) => item.toObject()),
          createdAt: new Date(),
        });
      } catch (error) {
        for (const item of applied) {
          await Product.updateOne({ _id: item.productId }, {
            $inc: { [`stockByVariant.${item.key}`]: item.quantity, quantity: item.quantity },
            $push: { stockHistory: { color: item.color, size: item.size, quantity: item.quantity, reason: 'order deduction reversed' } },
          });
        }
        await Order.updateOne({ _id: order._id }, { $set: { inventoryDeducted: false } });
        throw error;
      }
    }
  } else if (!approved && order.inventoryDeducted) {
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, inventoryDeducted: true },
      { $set: { inventoryDeducted: false } },
      { new: true }
    );
    if (claimed) {
      order.inventoryDeducted = false;
      for (const item of order.items) {
        const product = await Product.findById(item.productId);
        if (!product) continue;
        const inventory = completeVariantStock(product);
        product.stockByVariant = inventory;
        product.stockBySize = {};
        const key = variantStockKey(item.color, item.size);
        inventory.set(key, (inventory.get(key) || 0) + item.quantity);
        product.stockByVariant = inventory;
        product.quantity = [...inventory.values()].reduce((sum, count) => sum + count, 0);
        product.stockHistory.push({ color: item.color, size: item.size, quantity: item.quantity, reason: 'cancelled order returned', createdAt: new Date() });
        await product.save();
      }
      const sale = [...order.salesHistory].reverse().find((event) => event.type === 'sale' && !order.salesHistory.some((candidate) => candidate.type === 'reversal' && candidate.reverses === String(event._id)));
      if (sale) order.salesHistory.push({ type: 'reversal', status, reverses: String(sale._id), items: sale.items, createdAt: new Date() });
    }
  }

  order.status = status;
  await order.save();
  res.json({ order: order.toObject() });
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
  const sameVariants = p.sizeMin === data.sizeMin && p.sizeMax === data.sizeMax && JSON.stringify(p.colors) === JSON.stringify(data.colors);
  data.stockByVariant = sameVariants ? p.stockByVariant : {};
  data.stockBySize = sameVariants ? p.stockBySize : {};
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
  if (b.size !== undefined || b.color !== undefined) {
    const size = String(b.size);
    const color = String(b.color);
    if (!p.sizes.includes(size)) throw bad('Choose a size within this product range');
    if (!p.colors.includes(color)) throw bad('Choose a color for this product');
    const amount = int(b.delta, -100000, 100000, 'Stock change');
    if (!amount) throw bad('Stock change cannot be zero');
    const map = completeVariantStock(p);
    const key = variantStockKey(color, size);
    const next = (map.get(key) || 0) + amount;
    if (next < 0) throw bad('Stock cannot be reduced below zero');
    map.set(key, next);
    p.stockByVariant = map;
    p.stockBySize = {};
    p.stockHistory.push({ color, size, quantity: amount, reason: amount > 0 ? 'stock received' : 'manual adjustment', createdAt: new Date() });
    p.quantity = [...map.values()].reduce((sum, n) => sum + n, 0);
  }
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
app.get('/admin/sales', (req, res) => res.sendFile(path.join(pub, 'sales.html')));
app.get(['/shop', '/cart', '/checkout', '/about', '/contact', '/product/:id'], (req, res) =>
  res.sendFile(path.join(pub, 'index.html')));
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
