// Promo code rules. Money is calculated in integer kobo so totals are always
// exact to 2 decimals (Paystack needs whole kobo) and can never go negative.

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

function normalizeCode(raw) {
  return String(raw == null ? '' : raw).trim().toUpperCase();
}

function toKobo(naira) {
  return Math.round(Number(naira) * 100);
}
const fromKobo = (kobo) => kobo / 100;

function promoError(reason, message) {
  return Object.assign(new Error(message), { status: 400, expose: true, reason });
}

function formatNaira(n) {
  return '₦' + Number(n).toLocaleString('en-NG');
}

// Customer identity used for the per-customer limit: signed-in account, email, phone.
function normalizePhoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}
function identityKeys({ customerId, email, phone } = {}) {
  const keys = [];
  if (customerId) keys.push(`acct:${String(customerId)}`);
  const mail = String(email || '').trim().toLowerCase();
  if (mail) keys.push(`email:${mail}`);
  const phoneKey = normalizePhoneKey(phone);
  if (phoneKey) keys.push(`phone:${phoneKey}`);
  return keys;
}

function promoStatus(promo, now = new Date()) {
  if (!promo.active) return 'inactive';
  if (promo.expiresAt && new Date(promo.expiresAt) <= now) return 'expired';
  if (promo.startsAt && new Date(promo.startsAt) > now) return 'scheduled';
  if (promo.maxRedemptions != null &&
      (promo.reservedCount || 0) + (promo.redeemedCount || 0) >= promo.maxRedemptions) return 'exhausted';
  return 'active';
}

function lineIsEligible(promo, line) {
  if (promo.appliesTo !== 'selected') return true;
  const ids = new Set((promo.productIds || []).map(String));
  const categories = new Set((promo.categories || []).map((c) => String(c).trim().toLowerCase()));
  return ids.has(String(line.productId)) || categories.has(String(line.category || '').trim().toLowerCase());
}

/**
 * lines: [{ productId, category, unitPrice (NGN, already sale-priced, or null), quantity }]
 * deliveryFee: NGN number, or null when it is not known yet (no state chosen).
 * customerUses: how many times this customer already holds/used the code.
 * Throws a promoError (status 400) when the code cannot be used.
 */
function evaluatePromo({ promo, lines, deliveryFee = null, fulfillmentMethod = 'delivery', customerUses = 0, now = new Date() }) {
  const status = promoStatus(promo, now);
  if (status === 'inactive') throw promoError('invalid', 'This promo code is not valid.');
  if (status === 'expired') throw promoError('expired', 'This promo code has expired.');
  if (status === 'scheduled') throw promoError('not_started', 'This promo code is not active yet.');
  if (status === 'exhausted') throw promoError('exhausted', 'This promo code has reached its usage limit.');

  if (!lines.length) throw promoError('empty', 'Add something to your bag before using a promo code.');
  if (lines.some((line) => line.unitPrice == null)) {
    throw promoError('unpriced', 'Promo codes cannot be used while your bag has an item whose price is confirmed on WhatsApp.');
  }

  const lineKobo = lines.map((line) => toKobo(line.unitPrice) * Number(line.quantity));
  const subtotalKobo = lineKobo.reduce((sum, n) => sum + n, 0);
  const minKobo = toKobo(promo.minSubtotal || 0);
  if (subtotalKobo < minKobo) {
    throw promoError('min_subtotal', `Spend at least ${formatNaira(fromKobo(minKobo))} to use this promo code.`);
  }

  const eligibleKobo = lines.reduce((sum, line, i) => sum + (lineIsEligible(promo, line) ? lineKobo[i] : 0), 0);
  if (eligibleKobo <= 0) throw promoError('not_eligible', 'This promo code does not apply to the items in your bag.');

  if (promo.perCustomerLimit != null && customerUses >= promo.perCustomerLimit) {
    throw promoError('customer_limit', 'You have already used this promo code the maximum number of times.');
  }

  let itemDiscountKobo = 0;
  let deliveryDiscountKobo = 0;
  let deliveryPending = false;
  if (promo.discountType === 'percentage') {
    itemDiscountKobo = Math.floor((eligibleKobo * Number(promo.discountValue)) / 100);
    if (promo.maxDiscount != null) itemDiscountKobo = Math.min(itemDiscountKobo, toKobo(promo.maxDiscount));
  } else if (promo.discountType === 'fixed') {
    itemDiscountKobo = toKobo(promo.discountValue);
  } else if (promo.discountType === 'free_delivery') {
    if (fulfillmentMethod === 'pickup') {
      throw promoError('pickup', 'Free delivery does not apply to branch pickup orders.');
    }
    if (deliveryFee == null) deliveryPending = true;
    else deliveryDiscountKobo = toKobo(deliveryFee);
  } else {
    throw promoError('invalid', 'This promo code is not valid.');
  }
  itemDiscountKobo = Math.max(0, Math.min(itemDiscountKobo, eligibleKobo));

  const feeKobo = deliveryFee == null ? null : toKobo(deliveryFee);
  deliveryDiscountKobo = feeKobo == null ? 0 : Math.max(0, Math.min(deliveryDiscountKobo, feeKobo));
  const totalKobo = feeKobo == null ? null : subtotalKobo - itemDiscountKobo + feeKobo - deliveryDiscountKobo;

  return {
    code: promo.code,
    discountType: promo.discountType,
    discountValue: promo.discountType === 'free_delivery' ? 0 : Number(promo.discountValue),
    subtotal: fromKobo(subtotalKobo),
    eligibleSubtotal: fromKobo(eligibleKobo),
    itemDiscount: fromKobo(itemDiscountKobo),
    deliveryFee: feeKobo == null ? null : fromKobo(feeKobo),
    deliveryDiscount: fromKobo(deliveryDiscountKobo),
    deliveryDiscountPending: deliveryPending,
    totalDiscount: fromKobo(itemDiscountKobo + deliveryDiscountKobo),
    total: totalKobo == null ? null : fromKobo(totalKobo),
  };
}

// ---------- Redemption bookkeeping (run inside the order's MongoDB transaction) ----------
function models() {
  return { PromoCode: require('../models/PromoCode'), PromoUsage: require('../models/PromoUsage') };
}

async function countCustomerUses(promoId, keys) {
  if (!keys.length) return 0;
  const { PromoUsage } = models();
  const rows = await PromoUsage.find({ promoId, key: { $in: keys } }).select('count').lean();
  return rows.reduce((max, row) => Math.max(max, Number(row.count) || 0), 0);
}

// Atomically takes one slot for a pending order. Throws if the code stopped being usable.
async function reservePromo(order, session, now = new Date()) {
  const info = order.promo;
  if (!info) return;
  const { PromoCode, PromoUsage } = models();
  const reserved = await PromoCode.findOneAndUpdate({
    _id: info.promoId,
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $or: [{ maxRedemptions: null }, { $expr: { $lt: [{ $add: ['$reservedCount', '$redeemedCount'] }, '$maxRedemptions'] } }] },
    ],
  }, { $inc: { reservedCount: 1 } }, { new: true, session });
  if (!reserved) {
    throw promoError('unavailable', 'This promo code is no longer available. Remove it or try another code.');
  }
  const limit = reserved.perCustomerLimit;
  if (limit != null) {
    for (const key of info.usageKeys || []) {
      try {
        await PromoUsage.updateOne(
          { promoId: info.promoId, key, count: { $lt: limit } },
          { $inc: { count: 1 } },
          { upsert: true, session }
        );
      } catch (error) {
        if (error && error.code === 11000) {
          throw promoError('customer_limit', 'You have already used this promo code the maximum number of times.');
        }
        throw error;
      }
    }
  }
}

// Pending -> confirmed. Safe to call repeatedly.
async function redeemPromo(order, session) {
  const info = order.promo;
  if (!info || info.state !== 'reserved') return;
  const { PromoCode } = models();
  const moved = await PromoCode.updateOne(
    { _id: info.promoId, reservedCount: { $gte: 1 } },
    { $inc: { reservedCount: -1, redeemedCount: 1 } },
    { session }
  );
  if (!moved.modifiedCount) await PromoCode.updateOne({ _id: info.promoId }, { $inc: { redeemedCount: 1 } }, { session });
  order.promo = { ...info, state: 'redeemed' };
}

// Cancelled / expired / failed payment: give the slot back. Safe to call repeatedly.
async function releasePromo(order, session) {
  const info = order.promo;
  if (!info || !['reserved', 'redeemed'].includes(info.state)) return;
  const { PromoCode, PromoUsage } = models();
  const field = info.state === 'reserved' ? 'reservedCount' : 'redeemedCount';
  await PromoCode.updateOne({ _id: info.promoId, [field]: { $gte: 1 } }, { $inc: { [field]: -1 } }, { session });
  for (const key of info.usageKeys || []) {
    await PromoUsage.updateOne({ promoId: info.promoId, key, count: { $gte: 1 } }, { $inc: { count: -1 } }, { session });
  }
  order.promo = { ...info, state: 'released' };
}

module.exports = {
  CODE_PATTERN, normalizeCode, toKobo, fromKobo, promoError, identityKeys, normalizePhoneKey,
  promoStatus, lineIsEligible, evaluatePromo,
  countCustomerUses, reservePromo, redeemPromo, releasePromo,
};
