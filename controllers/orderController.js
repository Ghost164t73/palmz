const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { createReservedOrder, expireOrderReservations, orderBreakdown, orderContact } = require('../services/orders');
const { notifyOrderEmail } = require('../services/orderEmails');

// POST /api/orders
const createGuestOrder = async (req, res) => {
  await expireOrderReservations();
  const order = await createReservedOrder(new Order(await orderContact(req.body || {})));
  await notifyOrderEmail(order, 'admin_new_order');
  res.status(201).json({ order: { id: String(order._id), status: order.status }, breakdown: orderBreakdown(order) });
};

// POST /api/customer/orders
const createCustomerOrder = async (req, res) => {
  await expireOrderReservations();
  const customer = await Customer.findById(req.customerId);
  if (!customer) return res.status(401).json({ error: 'Please sign in' });
  const order = await createReservedOrder(new Order(await orderContact(req.body || {}, customer)));
  await notifyOrderEmail(order, 'admin_new_order');
  const saved = order.toObject();
  if (saved.promo) saved.promo = { ...saved.promo, usageKeys: undefined };
  res.status(201).json({ order: saved, breakdown: orderBreakdown(order) });
};

module.exports = {
  createGuestOrder,
  createCustomerOrder,
};
