const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expectedPaymentAmountKobo,
  paystackTransactionMismatches,
} = require('../lib/paystack');

test('Paystack amount validation supports stored kobo and legacy Naira totals', () => {
  assert.equal(expectedPaymentAmountKobo({ paymentAmountKobo: 1250000, totalAmount: 12500 }), 1250000);
  assert.equal(expectedPaymentAmountKobo({ paymentAmountKobo: 12500, totalAmount: 12500 }), 1250000);
  assert.equal(expectedPaymentAmountKobo({ paymentAmountKobo: null, totalAmount: 12500 }), 1250000);
  assert.equal(expectedPaymentAmountKobo({ paymentAmountKobo: undefined, totalAmount: 12500.5 }), 1250050);
  assert.equal(expectedPaymentAmountKobo({ paymentAmountKobo: null, totalAmount: null }), null);
  assert.equal(expectedPaymentAmountKobo({ paymentAmountKobo: null, totalAmount: 10.001 }), null);
});

test('Paystack transaction comparisons accept numeric string amounts and identify mismatches', () => {
  const order = { paymentAmountKobo: 1250000, totalAmount: 12500 };
  assert.deepEqual(paystackTransactionMismatches(order, {
    reference: 'palmz-reference',
    amount: '1250000',
    requested_amount: 1250000,
    currency: 'NGN',
  }, 'palmz-reference'), []);
  assert.deepEqual(paystackTransactionMismatches(order, {
    reference: 'other-reference',
    amount: 1249999,
    currency: 'USD',
  }, 'palmz-reference'), ['reference', 'amount', 'currency']);
  assert.deepEqual(paystackTransactionMismatches(
    { paymentAmountKobo: null, totalAmount: null },
    { reference: 'palmz-reference', amount: 1250000, currency: 'NGN' },
    'palmz-reference',
  ), ['amount']);
});

test('Paystack accepts an overcharge only when Paystack confirms the requested order amount', () => {
  const order = { paymentAmountKobo: 2700000, totalAmount: 27000 };
  assert.deepEqual(paystackTransactionMismatches(order, {
    reference: 'palmz-reference',
    amount: 2751270,
    requested_amount: 2700000,
    currency: 'NGN',
  }, 'palmz-reference'), []);
  assert.deepEqual(paystackTransactionMismatches(order, {
    reference: 'palmz-reference',
    amount: 2751270,
    requested_amount: 2751270,
    currency: 'NGN',
  }, 'palmz-reference'), ['amount', 'requested_amount']);
  assert.deepEqual(paystackTransactionMismatches(order, {
    reference: 'palmz-reference',
    amount: 2751270,
    requested_amount: 2600000,
    currency: 'NGN',
  }, 'palmz-reference'), ['amount', 'requested_amount']);
  assert.deepEqual(paystackTransactionMismatches(order, {
    reference: 'palmz-reference',
    amount: 2751270,
    currency: 'NGN',
  }, 'palmz-reference'), ['amount']);
  assert.deepEqual(paystackTransactionMismatches(order, {
    reference: 'palmz-reference',
    amount: 2699999,
    currency: 'NGN',
  }, 'palmz-reference'), ['amount']);
});
