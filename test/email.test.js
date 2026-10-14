const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderEmail, sendOrderEmail } = require('../lib/email');

const order = {
  _id: '507f1f77bcf86cd799439011',
  customerName: '<script>alert(1)</script>',
  email: 'customer@example.com',
  phone: '+2348000000000',
  paymentProvider: 'paystack',
  fulfillmentMethod: 'delivery',
  city: 'Kano',
  totalAmount: 12500,
  items: [{ quantity: 1, name: '<img src=x>', size: '43', color: 'Black' }],
};

test('order email templates escape customer and product data', () => {
  const message = buildOrderEmail('paystack_receipt', order);
  assert.equal(message.to, order.email);
  assert.match(message.subject, /Payment received/);
  assert.match(message.html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(message.html, /<img src=x>/);
  assert.match(message.html, /Order:.*439011/);
});

test('admin new-order email targets only the configured admin recipient', () => {
  const previous = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'admin@example.com';
  try {
    const message = buildOrderEmail('admin_new_order', order);
    assert.equal(message.to, 'admin@example.com');
    assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previous;
  }
});

test('email delivery keeps the Resend key server-side and uses an idempotency key', async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    fetch: global.fetch,
  };
  let request;
  process.env.RESEND_API_KEY = 'test-secret';
  process.env.EMAIL_FROM = 'PALMZ <orders@example.com>';
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200 };
  };
  try {
    await sendOrderEmail('paystack_receipt', order);
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
    assert.equal(request.options.headers['Idempotency-Key'], `palmz-${order._id}-paystack_receipt`);
    assert.equal(JSON.parse(request.options.body).to, order.email);
  } finally {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previous.from;
    global.fetch = previous.fetch;
  }
});