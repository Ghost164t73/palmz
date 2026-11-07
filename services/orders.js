const Order = require('../models/Order');
const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const mongoose = require('mongoose');
const { calculateOrderTotal, deliveryQuote, discountedPrice } = require('../lib/delivery');
const { countCustomerUses, evaluatePromo, identityKeys, normalizeCode, promoError, releasePromo, reservePromo } = require('../lib/promo');
const { groupOrderItems, variantStockKey } = require('../lib/inventory');
const { PICKUP_BRANCHES, RESERVATION_HOLD_MS } = require('../config/constants');
const { bad } = require('../utils/validation');
const { ensureDeliveryZones } = require('../config/db');

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

async function adjustInventoryForOrder(items, delta, reason, session, requireAvailable = false) {
  const grouped = groupOrderItems(items);
  const productIds = [...new Set(grouped.map((item) => item.productId))];
  const products = await Product.find({ _id: { $in: productIds } }).session(session);
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const normalized = new Set();

  for (const item of grouped) {
    const product = productsById.get(item.productId);
    if (!product) {
      if (delta > 0) continue;
      throw bad(`Product "${item.productId}" in this order no longer exists`);
    }
    if (!product.sizes.includes(String(item.size)) || !product.colors.includes(String(item.color))) {
      throw bad(`Product variants for ${item.name || item.productId} have changed`);
    }

    const inventory = completeVariantStock(product);
    const currentTotal = [...inventory.values()].reduce((sum, count) => sum + Number(count || 0), 0);
    if (!normalized.has(item.productId) && (!product.stockByVariant || !product.stockByVariant.size || product.quantity !== currentTotal)) {
      product.stockByVariant = inventory;
      product.stockBySize = {};
      product.quantity = currentTotal;
      await product.save({ session });
      normalized.add(item.productId);
    }

    const variantPath = `stockByVariant.${variantStockKey(item.color, item.size)}`;
    const filter = { _id: product._id };
    if (delta < 0) {
      filter[variantPath] = { $gte: item.quantity };
      filter.quantity = { $gte: item.quantity };
      if (requireAvailable) filter.available = true;
    }
    const result = await Product.updateOne(filter, {
      $inc: { [variantPath]: delta * item.quantity, quantity: delta * item.quantity },
      $push: { stockHistory: {
        color: item.color,
        size: item.size,
        quantity: delta * item.quantity,
        reason,
        createdAt: new Date(),
      } },
    }, { session });
    if (!result.modifiedCount) {
      throw bad(`There is not enough stock for ${item.color}, size ${item.size}`);
    }
  }
}

async function createReservedOrder(order) {
  const legacyPendingOrder = await Order.exists({
    status: 'pending_confirmation',
    inventoryReserved: { $ne: true },
    inventoryDeducted: { $ne: true },
  });
  if (legacyPendingOrder) {
    throw Object.assign(new Error('New orders are temporarily paused while older pending orders are being reconciled. Please try again shortly.'), {
      status: 503,
      expose: true,
    });
  }

  await mongoose.connection.transaction(async (session) => {
    await reservePromo(order, session);
    await order.save({ session });
    await adjustInventoryForOrder(order.items, -1, 'order reserved', session, true);
    order.inventoryReserved = true;
    await order.save({ session });
  });
  return order;
}

async function releaseOrderReservation(orderId, {
  paymentStatus,
  reason = 'order reservation released',
  onlyUnpaid = false,
} = {}) {
  let released = false;
  await mongoose.connection.transaction(async (session) => {
    const order = await Order.findById(orderId).session(session);
    if (!order || !order.inventoryReserved || order.inventoryDeducted) return;
    if (onlyUnpaid && ['paid', 'refunded'].includes(order.paymentStatus)) return;
    await adjustInventoryForOrder(order.items, 1, reason, session);
    await releasePromo(order, session);
    order.inventoryReserved = false;
    if (paymentStatus) order.paymentStatus = paymentStatus;
    order.status = 'cancelled';
    order.statusUpdatedAt = new Date();
    await order.save({ session });
    released = true;
  });
  return released;
}

async function expireOrderReservations(now = new Date(), limit = 100) {
  const reservations = await Order.find({
    status: 'pending_confirmation',
    paymentStatus: { $in: ['pending', 'not_started'] },
    inventoryReserved: true,
    inventoryDeducted: { $ne: true },
    reservationExpiresAt: { $lte: now },
  }).sort({ reservationExpiresAt: 1 }).limit(limit).select('_id').lean();
  let released = 0;
  for (const candidate of reservations) {
    try {
      const didRelease = await mongoose.connection.transaction(async (session) => {
        const order = await Order.findOne({
          _id: candidate._id,
          status: 'pending_confirmation',
          paymentStatus: { $in: ['pending', 'not_started'] },
          inventoryReserved: true,
          inventoryDeducted: { $ne: true },
          reservationExpiresAt: { $lte: now },
        }).session(session);
        if (!order) return false;
        await adjustInventoryForOrder(order.items, 1, 'expired order reservation returned', session);
        await releasePromo(order, session);
        order.inventoryReserved = false;
        order.status = 'cancelled';
        order.statusUpdatedAt = now;
        order.cancellationReason = 'reservation_expired';
        order.reservationExpiresAt = null;
        await order.save({ session });
        return true;
      });
      if (didRelease) released += 1;
    } catch (error) {
      console.error('Could not release expired order reservation', {
        orderId: String(candidate._id), message: error.message,
      });
    }
  }
  return released;
}

async function resolvePromo({ code, lines, deliveryFee, fulfillmentMethod, identity }) {
  const promo = await PromoCode.findOne({ code: normalizeCode(code) });
  if (!promo) throw promoError('invalid', 'This promo code is not valid.');
  const keys = identityKeys(identity);
  const customerUses = promo.perCustomerLimit != null ? await countCustomerUses(promo._id, keys) : 0;
  const breakdown = evaluatePromo({ promo, lines, deliveryFee, fulfillmentMethod, customerUses });
  return { promo, breakdown, keys };
}

function orderBreakdown(order) {
  const promo = order.promo || null;
  return {
    orderId: String(order._id),
    status: order.status,
    subtotal: order.subtotalAmount,
    promoCode: promo ? promo.code : null,
    itemDiscount: promo ? promo.itemDiscount : 0,
    deliveryFee: order.deliveryFee || 0,
    deliveryDiscount: promo ? promo.deliveryDiscount : 0,
    total: order.totalAmount,
  };
}

async function orderContact(body, account = null, paymentProvider = 'whatsapp') {
  const customerName = String(body.customerName || (account && account.name) || '').trim();
  const email = String((account && account.email) || body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const fulfillmentMethod = String(body.fulfillmentMethod || 'delivery');
  let address = String(body.address || '').trim();
  let streetAddress = String(body.streetAddress || '').trim();
  let area = String(body.area || '').trim();
  let landmark = String(body.landmark || '').trim();
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
    streetAddress = '';
    area = '';
    landmark = '';
  } else {
    const legacyAddressOnly = !streetAddress && !area;
    if (legacyAddressOnly) streetAddress = address;
    if (!streetAddress || streetAddress.length > 180) throw bad('Enter a street or building name of up to 180 characters');
    if (!legacyAddressOnly && (!area || area.length > 120)) throw bad('Enter an area or neighborhood of up to 120 characters');
    if (landmark.length > 180) throw bad('Nearby landmark must be 180 characters or fewer');
    address = [streetAddress, area, landmark].filter(Boolean).join(', ');
    if (address.length > 600) throw bad('The combined delivery address is too long');
    if (!city || city.length > 80) throw bad('Enter a city of 1 to 80 characters');
    deliveryState = String(body.state || '').trim();
    const quote = deliveryQuote(deliveryState, city, (await ensureDeliveryZones()).filter((zone) => zone.active));
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
      imageUrl: product.images && product.images[0] && product.images[0].url || product.image && product.image.url || '',
      size,
      color,
      quantity,
      unitPrice: discountedPrice(product.price),
    };
  });
  const subtotalAmount = calculateOrderTotal(items, 0);
  let totalAmount = calculateOrderTotal(items, deliveryFee);
  let promo = null;
  const promoCode = normalizeCode(body.promoCode);
  if (promoCode) {
    const resolved = await resolvePromo({
      code: promoCode,
      lines: items.map((item) => ({
        productId: item.productId,
        category: productsById.get(item.productId).type,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
      deliveryFee,
      fulfillmentMethod,
      identity: { customerId: account && account._id, email, phone },
    });
    const { breakdown } = resolved;
    totalAmount = breakdown.total;
    promo = {
      promoId: String(resolved.promo._id),
      code: breakdown.code,
      discountType: breakdown.discountType,
      discountValue: breakdown.discountValue,
      eligibleSubtotal: breakdown.eligibleSubtotal,
      itemDiscount: breakdown.itemDiscount,
      deliveryDiscount: breakdown.deliveryDiscount,
      totalDiscount: breakdown.totalDiscount,
      usageKeys: resolved.promo.perCustomerLimit != null ? resolved.keys : [],
      state: 'reserved',
    };
  }
  for (const [productId, quantity] of quantities) {
    if (quantity > productsById.get(productId).quantity) throw bad('There is not enough stock for an item in your bag');
  }

  return {
    ...(account ? { customer: account._id, source: 'account' } : { source: 'guest' }),
    customerName,
    email,
    phone,
    address,
    streetAddress,
    area,
    landmark,
    city,
    fulfillmentMethod,
    deliveryState,
    deliveryFee,
    deliveryEstimate,
    subtotalAmount,
    totalAmount,
    promo,
    pickupBranchId: pickupBranch ? String(body.pickupBranchId) : '',
    pickupBranchName: pickupBranch ? pickupBranch.name : '',
    pickupBranchAddress: pickupBranch ? pickupBranch.address : '',
    note,
    items,
    paymentProvider,
    paymentStatus: paymentProvider === 'paystack' ? 'pending' : 'not_started',
    reservationExpiresAt: new Date(Date.now() + RESERVATION_HOLD_MS[paymentProvider]),
  };
}

module.exports = {
  completeVariantStock,
  adjustInventoryForOrder,
  createReservedOrder,
  releaseOrderReservation,
  expireOrderReservations,
  resolvePromo,
  orderBreakdown,
  orderContact,
};
