const Customer = require('../models/Customer');
const Order = require('../models/Order');
const crypto = require('crypto');
const { applyPaystackTransaction, createPaystackOrder, verifyPaystackTransaction } = require('../services/paystack');
const { connectDb } = require('../config/db');

// POST /api/orders/paystack
const createGuestPaystackOrder = async (req, res) => {
  const authorizationUrl = await createPaystackOrder(req);
  res.status(201).json({ authorizationUrl });
};

// POST /api/customer/orders/paystack
const createCustomerPaystackOrder = async (req, res) => {
  const customer = await Customer.findById(req.customerId);
  if (!customer) return res.status(401).json({ error: 'Please sign in' });
  const authorizationUrl = await createPaystackOrder(req, customer);
  res.status(201).json({ authorizationUrl });
};

// GET /paystack/callback
const paystackCallback = async (req, res) => {
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
    if (paymentStatus === 'paid_after_cancellation') {
      return res.redirect(`/checkout?payment=paid_after_cancellation&reference=${encodeURIComponent(reference)}`);
    }
    if (paymentStatus === 'failed') return res.redirect('/checkout?payment=failed');
    return res.redirect('/checkout?payment=pending');
  } catch (error) {
    console.error('Paystack callback verification failed:', error.message);
    return res.redirect('/checkout?payment=unverified');
  }
};

// POST /api/paystack/webhook
const paystackWebhook = async (req, res) => {
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
  if (transaction.status !== 'success') {
    console.error('Paystack webhook received a non-success charge event', { orderId: String(order._id) });
    return res.status(400).json({ error: 'Paystack transaction does not match the order' });
  }
  try {
    await applyPaystackTransaction(order, transaction, order.paystackReference);
  } catch (error) {
    if (error.code === 'PAYSTACK_TRANSACTION_MISMATCH') {
      console.error('Paystack webhook transaction did not match its order', { orderId: String(order._id) });
      return res.status(400).json({ error: 'Paystack transaction does not match the order' });
    }
    console.error('Paystack webhook settlement failed', { orderId: String(order._id) });
    return res.status(500).json({ error: 'Could not process Paystack transaction' });
  }
  res.json({ received: true });
};

module.exports = {
  createGuestPaystackOrder,
  createCustomerPaystackOrder,
  paystackCallback,
  paystackWebhook,
};
