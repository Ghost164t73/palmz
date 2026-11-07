const Order = require('../models/Order');
const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const PromoUsage = require('../models/PromoUsage');
const mongoose = require('mongoose');
const { CODE_PATTERN, normalizeCode, promoError } = require('../lib/promo');
const { deliveryQuote, discountedPrice } = require('../lib/delivery');
const { bad } = require('../utils/validation');
const { ensureDeliveryZones } = require('../config/db');
const { expireOrderReservations, resolvePromo } = require('../services/orders');
const { optionalCustomerId } = require('../middleware/auth');
const { presentPromo, readPromoFields } = require('../services/promos');

// POST /api/promo/validate
const validatePromo = async (req, res) => {
  const body = req.body || {};
  const code = normalizeCode(body.code);
  if (!code) throw bad('Enter a promo code');
  if (!CODE_PATTERN.test(code)) throw promoError('invalid', 'This promo code is not valid.');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50 ||
      body.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw bad('Add something to your bag before using a promo code.');
  }
  const ids = [...new Set(body.items.map((item) => String(item.productId || '')))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw bad('An item in your bag is no longer available');
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const lines = body.items.map((item) => {
    const product = byId.get(String(item.productId));
    const quantity = Number(item.quantity);
    if (!product || !product.inStock || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw bad('An item in your bag is no longer available');
    }
    return { productId: String(product._id), category: product.type, unitPrice: discountedPrice(product.price), quantity };
  });
  const fulfillmentMethod = body.fulfillmentMethod === 'pickup' ? 'pickup' : 'delivery';
  let deliveryFee = null;
  if (fulfillmentMethod === 'pickup') deliveryFee = 0;
  else {
    const quote = deliveryQuote(String(body.state || '').trim(), String(body.city || '').trim(), (await ensureDeliveryZones()).filter((zone) => zone.active));
    if (quote) deliveryFee = quote.fee;
  }
  const { breakdown } = await resolvePromo({
    code, lines, deliveryFee, fulfillmentMethod,
    identity: { customerId: optionalCustomerId(req), email: body.email, phone: body.phone },
  });
  res.set('Cache-Control', 'no-store');
  res.json({ valid: true, ...breakdown });
};

// GET /api/admin/promos
const listPromos = async (req, res) => {
  await expireOrderReservations();
  const promos = await PromoCode.find().sort({ createdAt: -1 });
  res.set('Cache-Control', 'no-store');
  res.json({ promos: promos.map((promo) => presentPromo(promo)) });
};

// POST /api/admin/promos
const createPromo = async (req, res) => {
  const fields = await readPromoFields(req.body || {}, { creating: true });
  try {
    const promo = await PromoCode.create({ active: true, ...fields });
    res.status(201).json({ promo: presentPromo(promo) });
  } catch (error) {
    if (error && error.code === 11000) throw bad('A promo code with this name already exists');
    throw error;
  }
};

// PUT /api/admin/promos/:id
const updatePromo = async (req, res) => {
  const promo = await PromoCode.findById(req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promo code not found' });
  const fields = await readPromoFields(req.body || {}, { used: promo.reservedCount + promo.redeemedCount });
  promo.set(fields); // the code itself and the usage counters are never edited here
  await promo.save();
  res.json({ promo: presentPromo(promo) });
};

// PATCH /api/admin/promos/:id/active
const setPromoActive = async (req, res) => {
  if (typeof (req.body || {}).active !== 'boolean') throw bad('Send active as true or false');
  const promo = await PromoCode.findByIdAndUpdate(req.params.id, { $set: { active: req.body.active } }, { new: true });
  if (!promo) return res.status(404).json({ error: 'Promo code not found' });
  res.json({ promo: presentPromo(promo) });
};

// DELETE /api/admin/promos/:id
const deletePromo = async (req, res) => {
  if (await Order.exists({ 'promo.promoId': req.params.id })) {
    throw bad('This code has orders attached to it. Deactivate it instead so the order history is kept.');
  }
  const promo = await PromoCode.findByIdAndDelete(req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promo code not found' });
  await PromoUsage.deleteMany({ promoId: promo._id });
  res.json({ ok: true });
};

// GET /api/admin/promos/:id/orders
const listPromoOrders = async (req, res) => {
  await expireOrderReservations();
  const orders = await Order.find({ 'promo.promoId': req.params.id })
    .select('customerName email phone status paymentProvider paymentStatus subtotalAmount deliveryFee totalAmount promo createdAt')
    .sort({ createdAt: -1 }).limit(200).lean();
  res.json({ orders: orders.map((order) => ({ ...order, promo: order.promo && { ...order.promo, usageKeys: undefined } })) });
};

module.exports = {
  validatePromo,
  listPromos,
  createPromo,
  updatePromo,
  setPromoActive,
  deletePromo,
  listPromoOrders,
};
