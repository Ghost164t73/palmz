const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderEmail, sendOrderEmail } = require('../lib/email');

const order = {
  _id: '507f1f77bcf86cd799439011',
  customerName: '<script>alert(1)</script>',
  email: 'customer@example.com',
  phone: '+2348000000000',
  paymentProvider: 'paystack',
  paymentStatus: 'paid',
  fulfillmentMethod: 'delivery',
  address: 'Karkasara way No. 17',
  city: 'Kano',
  deliveryFee: 2000,
  totalAmount: 14500,
  createdAt: new Date('2026-10-14T12:00:00.000Z'),
  items: [{ quantity: 1, name: '<img src=x>', size: '43', color: 'Black', unitPrice: 12500 }],
};

test('order email templates escape customer and product data', () => {
  const previousSupportEmail = process.env.SUPPORT_EMAIL;
  process.env.SUPPORT_EMAIL = 'support@example.com';
  try {
    const message = buildOrderEmail('paystack_receipt', order);
    assert.equal(message.to, order.email);
    assert.match(message.subject, /Thank you for your PALMZ order/);
    assert.match(message.html, /Hi &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(message.html, /Order summary/);
    assert.match(message.html, /14 October 2026/);
    assert.match(message.html, /&lt;img src=x&gt;/);
    assert.doesNotMatch(message.html, /<img src=x>/);
    assert.match(message.html, /Subtotal/);
    assert.match(message.html, /Delivery details/);
    assert.match(message.html, /Payment method: Paystack · Paid/);
    assert.match(message.html, /\+2348000000000/);
    assert.match(message.html, /customer@example\.com/);
    assert.match(message.html, /support@example\.com/);
    assert.match(message.html, /12,500\.00/);
    assert.match(message.html, /14,500\.00/);
  } finally {
    if (previousSupportEmail === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = previousSupportEmail;
  }
});

test('customer order email avoids inventing prices or delivery for WhatsApp pickup', () => {
  const pickupOrder = {
    ...order,
    paymentProvider: 'whatsapp',
    paymentStatus: 'not_started',
    fulfillmentMethod: 'pickup',
    pickupBranchName: 'Shop 1',
    pickupBranchAddress: 'Genesis Plaza, NTA Roundabout',
    city: 'Lokoja, Kogi State',
    deliveryFee: 0,
    totalAmount: null,
    items: [{ ...order.items[0], unitPrice: null }],
  };
  const message = buildOrderEmail('status_confirmed', pickupOrder);
  assert.match(message.html, /Pickup details/);
  assert.match(message.html, /Genesis Plaza, NTA Roundabout/);
  assert.match(message.html, /WhatsApp order · PALMZ will confirm payment details/);
  assert.match(message.html, /To be confirmed/);
  assert.doesNotMatch(message.html, /Delivery details/);
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

test('email delivery reports Resend rejection details without logging request data', async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    fetch: global.fetch,
  };
  process.env.RESEND_API_KEY = 'test-secret';
  process.env.EMAIL_FROM = 'PALMZ <orders@example.com>';
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message: 'The sending domain is not verified' }),
  });
  try {
    await assert.rejects(
      sendOrderEmail('paystack_receipt', order),
      /Resend returned HTTP 403: The sending domain is not verified/,
    );
  } finally {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previous.from;
    global.fetch = previous.fetch;
  }
});