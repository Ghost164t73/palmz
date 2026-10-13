const test = require('node:test');
const assert = require('node:assert/strict');
const { DELIVERY_TIERS, deliveryQuote, calculateOrderTotal } = require('../lib/delivery');

test('delivery tiers cover each Nigerian state and the FCT exactly once', () => {
  const states = DELIVERY_TIERS.flatMap((tier) => tier.states);
  assert.equal(states.length, 37);
  assert.equal(new Set(states).size, 37);
});

test('delivery quotes use the supplied fees and delivery estimates', () => {
  const expected = [
    { fee: 2000, estimate: '1-2 working days', states: ['Kano'] },
    { fee: 3500, estimate: '2-3 working days', states: ['Jigawa', 'Katsina', 'Kaduna', 'Bauchi'] },
    { fee: 5000, estimate: '3-4 working days', states: ['FCT (Abuja)', 'Plateau', 'Gombe', 'Zamfara', 'Yobe'] },
    { fee: 7000, estimate: '4-5 working days', states: ['Nasarawa', 'Niger', 'Kebbi', 'Sokoto', 'Kogi', 'Benue', 'Adamawa', 'Taraba', 'Borno'] },
    { fee: 9000, estimate: '5-6 working days', states: ['Kwara', 'Enugu', 'Ebonyi', 'Anambra', 'Edo', 'Ekiti', 'Osun', 'Oyo', 'Ondo'] },
    { fee: 11000, estimate: '5-7 working days', states: ['Lagos', 'Ogun', 'Delta', 'Imo', 'Abia', 'Rivers', 'Bayelsa', 'Akwa Ibom', 'Cross River'] },
  ];

  assert.deepEqual(DELIVERY_TIERS, expected);
  for (const tier of expected) {
    for (const state of tier.states) {
      assert.deepEqual(deliveryQuote(state), tier);
    }
  }
  assert.equal(deliveryQuote('Unknown'), null);
});

test('order totals add authoritative item prices and the selected state delivery fee', () => {
  assert.equal(calculateOrderTotal([
    { unitPrice: 12000, quantity: 2 },
    { unitPrice: 7500, quantity: 1 },
  ], 3500), 35000);
  assert.equal(calculateOrderTotal([{ unitPrice: null, quantity: 1 }], 2000), null);
  assert.equal(calculateOrderTotal([{ unitPrice: 12000, quantity: 2 }], 0), 24000);
});
