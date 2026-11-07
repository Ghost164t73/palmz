const Product = require('../models/Product');
const PromoCode = require('../models/PromoCode');
const mongoose = require('mongoose');
const { CODE_PATTERN, normalizeCode, promoStatus } = require('../lib/promo');
const { bad, int } = require('../utils/validation');

function presentPromo(promo, now = new Date()) {
  const raw = promo.toObject ? promo.toObject() : promo;
  return {
    id: String(raw._id),
    code: raw.code,
    description: raw.description || '',
    discountType: raw.discountType,
    discountValue: raw.discountValue,
    minSubtotal: raw.minSubtotal || 0,
    maxDiscount: raw.maxDiscount == null ? null : raw.maxDiscount,
    startsAt: raw.startsAt || null,
    expiresAt: raw.expiresAt || null,
    maxRedemptions: raw.maxRedemptions == null ? null : raw.maxRedemptions,
    perCustomerLimit: raw.perCustomerLimit == null ? null : raw.perCustomerLimit,
    appliesTo: raw.appliesTo,
    productIds: raw.productIds || [],
    categories: raw.categories || [],
    active: raw.active,
    reservedCount: raw.reservedCount || 0,
    redeemedCount: raw.redeemedCount || 0,
    usedCount: (raw.reservedCount || 0) + (raw.redeemedCount || 0),
    status: promoStatus(raw, now),
    createdAt: raw.createdAt,
  };
}

function promoNumber(value, label, { min = 0, max = Infinity, minExclusive = false } = {}) {
  const n = Number(value);
  const bad2 = !Number.isFinite(n) || (minExclusive ? n <= min : n < min) || n > max ||
    Math.abs(Math.round(n * 100) / 100 - n) > 1e-9;
  if (bad2) throw bad(`${label} must be a valid number${min > 0 || minExclusive ? ' greater than ' + min : ''} (up to 2 decimal places)`);
  return n;
}

function optionalPromoInt(value, label) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return int(value, 1, 10000000, label);
}

function optionalPromoDate(value, label) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw bad(`${label} is not a valid date`);
  return date;
}

async function readPromoFields(b, { creating = false, used = 0 } = {}) {
  const fields = {};
  if (creating) {
    const code = normalizeCode(b.code);
    if (!CODE_PATTERN.test(code)) throw bad('Code must be 3 to 30 characters: letters, numbers, hyphen or underscore (e.g. PALMZ10)');
    fields.code = code;
  }
  fields.description = String(b.description || '').trim().slice(0, 200);
  if (!PromoCode.DISCOUNT_TYPES.includes(b.discountType)) throw bad('Choose percentage, fixed amount or free delivery');
  fields.discountType = b.discountType;
  if (b.discountType === 'percentage') {
    fields.discountValue = promoNumber(b.discountValue, 'Percentage', { min: 0, max: 100, minExclusive: true });
  } else if (b.discountType === 'fixed') {
    fields.discountValue = promoNumber(b.discountValue, 'Discount amount', { min: 0, max: 10000000, minExclusive: true });
  } else {
    fields.discountValue = 0;
  }
  fields.minSubtotal = String(b.minSubtotal ?? '').trim() === '' ? 0 : promoNumber(b.minSubtotal, 'Minimum order', { min: 0, max: 100000000 });
  fields.maxDiscount = b.discountType === 'percentage' && String(b.maxDiscount ?? '').trim() !== ''
    ? promoNumber(b.maxDiscount, 'Maximum discount', { min: 0, max: 100000000, minExclusive: true })
    : null;
  fields.startsAt = optionalPromoDate(b.startsAt, 'Start date');
  fields.expiresAt = optionalPromoDate(b.expiresAt, 'Expiry date');
  if (fields.startsAt && fields.expiresAt && fields.expiresAt <= fields.startsAt) throw bad('Expiry must be after the start date');
  fields.maxRedemptions = optionalPromoInt(b.maxRedemptions, 'Total redemption limit');
  if (fields.maxRedemptions != null && fields.maxRedemptions < used) {
    throw bad(`Total redemption limit cannot be below the ${used} already used or held by pending orders`);
  }
  fields.perCustomerLimit = optionalPromoInt(b.perCustomerLimit, 'Per-customer limit');
  fields.appliesTo = b.appliesTo === 'selected' ? 'selected' : 'all';
  if (fields.appliesTo === 'selected') {
    const productIds = [...new Set((Array.isArray(b.productIds) ? b.productIds : []).map(String))];
    if (productIds.length > 200 || productIds.some((id) => !mongoose.isValidObjectId(id))) throw bad('One of the selected products is invalid');
    if (productIds.length && await Product.countDocuments({ _id: { $in: productIds } }) !== productIds.length) {
      throw bad('One of the selected products no longer exists');
    }
    const categories = [...new Set((Array.isArray(b.categories) ? b.categories : []).map((c) => String(c).trim()).filter(Boolean))];
    if (categories.length > 50 || categories.some((c) => c.length > 40)) throw bad('Too many or too long category names');
    if (!productIds.length && !categories.length) throw bad('Choose at least one product or category, or apply the code to all products');
    fields.productIds = productIds;
    fields.categories = categories;
  } else {
    fields.productIds = [];
    fields.categories = [];
  }
  if (b.active !== undefined) fields.active = b.active === true || b.active === 'true';
  return fields;
}

module.exports = {
  presentPromo,
  promoNumber,
  optionalPromoInt,
  optionalPromoDate,
  readPromoFields,
};
