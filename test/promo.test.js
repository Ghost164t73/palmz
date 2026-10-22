const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCode, evaluatePromo, promoStatus, identityKeys } = require('../lib/promo');

const base = {
  code: 'PALMZ10', active: true, discountType: 'percentage', discountValue: 10, minSubtotal: 0,
  maxDiscount: null, startsAt: null, expiresAt: null, maxRedemptions: null, perCustomerLimit: null,
  appliesTo: 'all', productIds: [], categories: [], reservedCount: 0, redeemedCount: 0,
};
const lines = [
  { productId: 'a', category: 'Cross Strap', unitPrice: 9000, quantity: 2 },
  { productId: 'b', category: 'Palm', unitPrice: 4500, quantity: 1 },
];
const run = (promo = {}, extra = {}) => evaluatePromo({ promo: { ...base, ...promo }, lines, deliveryFee: 2000, ...extra });
const fails = (promo, extra, reason) => assert.throws(() => run(promo, extra), (e) => e.reason === reason && e.status === 400);

test('codes are trimmed and uppercased', () => {
  assert.equal(normalizeCode('  palmz10 '), 'PALMZ10');
  assert.equal(normalizeCode(null), '');
});

test('percentage discount applies to the eligible subtotal and totals add up', () => {
  const r = run();
  assert.equal(r.subtotal, 22500);
  assert.equal(r.itemDiscount, 2250);
  assert.equal(r.total, 22500 - 2250 + 2000);
});

test('percentage discount honours the maximum discount cap', () => {
  assert.equal(run({ maxDiscount: 1000 }).itemDiscount, 1000);
});

test('fixed discount never exceeds the eligible subtotal', () => {
  assert.equal(run({ discountType: 'fixed', discountValue: 5000 }).itemDiscount, 5000);
  const big = run({ discountType: 'fixed', discountValue: 999999 });
  assert.equal(big.itemDiscount, 22500);
  assert.equal(big.total, 2000);
});

test('100% off leaves only delivery and never goes negative', () => {
  const r = run({ discountValue: 100 });
  assert.equal(r.total, 2000);
});

test('free delivery waives the fee, is pending without a fee, and rejects pickup', () => {
  const r = run({ discountType: 'free_delivery' });
  assert.equal(r.deliveryDiscount, 2000);
  assert.equal(r.total, 22500);
  const pending = run({ discountType: 'free_delivery' }, { deliveryFee: null });
  assert.equal(pending.deliveryDiscountPending, true);
  assert.equal(pending.total, null);
  fails({ discountType: 'free_delivery' }, { fulfillmentMethod: 'pickup', deliveryFee: 0 }, 'pickup');
});

test('minimum order subtotal is enforced', () => {
  fails({ minSubtotal: 30000 }, {}, 'min_subtotal');
  assert.equal(run({ minSubtotal: 22500 }).itemDiscount, 2250);
});

test('inactive, expired, scheduled and exhausted codes are rejected', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  fails({ active: false }, { now }, 'invalid');
  fails({ expiresAt: new Date('2026-10-21T00:00:00Z') }, { now }, 'expired');
  fails({ startsAt: new Date('2026-10-23T00:00:00Z') }, { now }, 'not_started');
  fails({ maxRedemptions: 5, reservedCount: 2, redeemedCount: 3 }, { now }, 'exhausted');
  assert.equal(promoStatus({ ...base, maxRedemptions: 5, reservedCount: 2, redeemedCount: 2 }, now), 'active');
});

test('per-customer limit blocks repeat use', () => {
  fails({ perCustomerLimit: 1 }, { customerUses: 1 }, 'customer_limit');
  assert.ok(run({ perCustomerLimit: 2 }, { customerUses: 1 }));
});

test('product and category restrictions only discount eligible lines', () => {
  const byProduct = run({ appliesTo: 'selected', productIds: ['b'] });
  assert.equal(byProduct.eligibleSubtotal, 4500);
  assert.equal(byProduct.itemDiscount, 450);
  const byCategory = run({ appliesTo: 'selected', categories: ['cross strap'] });
  assert.equal(byCategory.eligibleSubtotal, 18000);
  fails({ appliesTo: 'selected', productIds: ['zzz'] }, {}, 'not_eligible');
});

test('items without a set price cannot be discounted', () => {
  assert.throws(() => evaluatePromo({
    promo: base, lines: [{ productId: 'a', category: 'Palm', unitPrice: null, quantity: 1 }], deliveryFee: 0,
  }), (e) => e.reason === 'unpriced');
});

test('amounts stay exact to the kobo', () => {
  const r = evaluatePromo({
    promo: { ...base, discountValue: 12.5 },
    lines: [{ productId: 'a', category: 'Palm', unitPrice: 8100.1, quantity: 3 }], deliveryFee: 2000,
  });
  assert.equal(Math.round(r.total * 100), r.total * 100);
  assert.equal(r.total, r.subtotal - r.itemDiscount + 2000);
});

test('identity keys combine account, email and normalised phone', () => {
  assert.deepEqual(identityKeys({ customerId: 'c1', email: ' A@B.com ', phone: '+234 803 123 4567' }),
    ['acct:c1', 'email:a@b.com', 'phone:8031234567']);
  assert.deepEqual(identityKeys({ phone: '08031234567' }), ['phone:8031234567']);
});
