const Order = require('../models/Order');
const mongoose = require('mongoose');
const { redeemPromo, releasePromo } = require('../lib/promo');
const { NEXT_ORDER_STATUSES, SALES_STATUSES } = require('../config/constants');
const { adjustInventoryForOrder, expireOrderReservations } = require('../services/orders');
const { bad } = require('../utils/validation');
const { notifyOrderEmail } = require('../services/orderEmails');

// GET /api/admin/orders
const listOrders = async (req, res) => {
  await expireOrderReservations();
  const filter = {};
  if (req.query.status && req.query.status !== 'all') {
    if (!Order.ORDER_STATUSES.includes(req.query.status)) throw bad('Unknown order status');
    filter.status = req.query.status;
  }
  if (req.query.fulfillmentMethod && req.query.fulfillmentMethod !== 'all') {
    if (!['delivery', 'pickup'].includes(req.query.fulfillmentMethod)) throw bad('Choose a valid fulfillment method');
    filter.fulfillmentMethod = req.query.fulfillmentMethod;
  }
  const dispatchStatuses = {
    awaiting_dispatch: ['pending_confirmation', 'confirmed', 'preparing'],
    dispatched: ['dispatched'],
    out_for_delivery: ['out_for_delivery'],
    delivered: ['delivered', 'fulfilled'],
  };
  if (req.query.dispatchStage && req.query.dispatchStage !== 'all') {
    const statuses = dispatchStatuses[req.query.dispatchStage];
    if (!statuses) throw bad('Choose a valid dispatch stage');
    if (filter.fulfillmentMethod === 'pickup') {
      filter.status = { $in: [] };
    } else {
      filter.fulfillmentMethod = 'delivery';
    }
    if (filter.status && Array.isArray(filter.status.$in) && filter.status.$in.length === 0) {
      // Keep contradictory pickup and dispatch filters empty.
    } else if (typeof filter.status === 'string') {
      if (!statuses.includes(filter.status)) filter.status = { $in: [] };
    } else {
      filter.status = { $in: statuses };
    }
  }
  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ orders, statuses: Order.ORDER_STATUSES });
};

// PATCH /api/admin/orders/:id/delivery
const updateDelivery = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const body = req.body || {};
  const courier = String(body.courier || '').trim();
  const trackingReference = String(body.trackingReference || '').trim();
  const deliveryNotes = String(body.deliveryNotes || '').trim();
  if (courier.length > 100) throw bad('Courier name must be 100 characters or fewer');
  if (trackingReference.length > 120) throw bad('Tracking reference must be 120 characters or fewer');
  if (deliveryNotes.length > 1000) throw bad('Delivery notes must be 1000 characters or fewer');
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.fulfillmentMethod !== 'delivery') throw bad('Delivery handling details only apply to delivery orders');
  order.courier = courier;
  order.trackingReference = trackingReference;
  order.deliveryNotes = deliveryNotes;
  await order.save();
  res.json({ order: order.toObject() });
};

// PATCH /api/admin/orders/:id/payment
const updatePayment = async (req, res) => {
  await expireOrderReservations();
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'cancelled') throw bad('A cancelled order cannot be marked as paid');
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
};

// GET /api/admin/sales
const salesReport = async (req, res) => {
  await expireOrderReservations();
  const orders = await Order.find({
    $or: [
      { 'salesHistory.0': { $exists: true } },
      { status: { $in: SALES_STATUSES } },
    ],
  }).sort({ createdAt: -1 }).select('customerName email status items salesHistory promo createdAt updatedAt').lean();
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
        promoCode: order.promo ? order.promo.code : '', itemDiscount: order.promo ? order.promo.itemDiscount : 0,
      });
    });
    if (!recordedSales.length && SALES_STATUSES.includes(order.status)) {
      sales.push({
        id: `legacy-${order._id}`, orderId: String(order._id), customerName: order.customerName,
        email: order.email, status: order.status, soldAt: order.updatedAt || order.createdAt,
        items: order.items, reversed: false, legacy: true,
        promoCode: order.promo ? order.promo.code : '', itemDiscount: order.promo ? order.promo.itemDiscount : 0,
      });
    }
  }
  sales.sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt));
  res.json({ sales });
};

// PATCH /api/admin/orders/:id
const updateStatus = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
  const status = req.body && req.body.status;
  if (!Order.ORDER_STATUSES.includes(status)) throw bad('Choose a valid order status');
  let order;
  const approved = SALES_STATUSES.includes(status);
  await mongoose.connection.transaction(async (session) => {
    order = await Order.findById(req.params.id).session(session);
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404, expose: true });
    if (!NEXT_ORDER_STATUSES[order.status]?.includes(status)) {
      throw bad(`Move this order forward from ${order.status.replaceAll('_', ' ')}; cancelled and completed orders cannot be reopened.`);
    }
    if (order.fulfillmentMethod === 'pickup' && ['dispatched', 'out_for_delivery', 'delivered'].includes(status)) {
      throw bad('Use Preparing, Ready for pickup, then Fulfilled for pickup orders.');
    }
    if (status === 'ready_for_pickup' && order.fulfillmentMethod !== 'pickup') {
      throw bad('Ready for pickup status only applies to pickup orders.');
    }
    if (order.fulfillmentMethod === 'pickup' && status === 'fulfilled' && order.status !== 'ready_for_pickup') {
      throw bad('Mark the pickup order ready before marking it fulfilled.');
    }
    if (approved && order.paymentProvider === 'paystack' && order.paymentStatus !== 'paid') {
      throw bad('A Paystack order must be paid before processing can continue');
    }

    if (approved && !order.inventoryDeducted) {
      if (order.inventoryReserved) {
        order.inventoryReserved = false;
      } else {
        await adjustInventoryForOrder(order.items, -1, 'confirmed order', session);
      }
      order.inventoryDeducted = true;
      order.salesHistory.push({
        type: 'sale',
        status,
        items: order.items.map((item) => item.toObject()),
        createdAt: new Date(),
      });
    } else if (!approved && order.inventoryReserved) {
      await adjustInventoryForOrder(order.items, 1, 'cancelled order returned', session);
      order.inventoryReserved = false;
    } else if (!approved && order.inventoryDeducted) {
      await adjustInventoryForOrder(order.items, 1, 'cancelled order returned', session);
      order.inventoryDeducted = false;
      const sale = [...order.salesHistory].reverse().find((event) => event.type === 'sale' && !order.salesHistory.some((candidate) => candidate.type === 'reversal' && candidate.reverses === String(event._id)));
      if (sale) order.salesHistory.push({ type: 'reversal', status, reverses: String(sale._id), items: sale.items, createdAt: new Date() });
    }

    if (approved) await redeemPromo(order, session);
    else if (status === 'cancelled') await releasePromo(order, session);

    order.status = status;
    order.statusUpdatedAt = new Date();
    if (status !== 'pending_confirmation') order.reservationExpiresAt = null;
    order.cancellationReason = '';
    await order.save({ session });
  });
  if (SALES_STATUSES.includes(status)) {
    await notifyOrderEmail(order, `status_${status}`);
  }
  res.json({ order: order.toObject() });
};

module.exports = {
  listOrders,
  updateDelivery,
  updatePayment,
  salesReport,
  updateStatus,
};
