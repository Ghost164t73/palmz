const RESEND_URL = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function orderNumber(order) {
  return String(order._id || '').slice(-8).toUpperCase();
}

function buildOrderEmail(event, order) {
  const number = orderNumber(order);
  const total = order.totalAmount == null
    ? 'To be confirmed'
    : `₦${Number(order.totalAmount).toLocaleString('en-NG')}`;
  const items = (order.items || []).map((item) => ({
    text: `${Number(item.quantity)} × ${item.name} — size ${item.size}, ${item.color}`,
    html: `${Number(item.quantity)} × ${escapeHtml(item.name)} — size ${escapeHtml(item.size)}, ${escapeHtml(item.color)}`,
  }));
  const itemText = items.length ? items.map((item) => item.text).join('\n') : 'No item details';
  const itemHtml = items.length ? items.map((item) => `<li>${item.html}</li>`).join('') : '<li>No item details</li>';
  const delivery = order.fulfillmentMethod === 'pickup'
    ? `Pickup: ${order.pickupBranchName || 'PALMZ branch'}`
    : `Delivery to ${order.city || 'your address'}`;

  let to = order.email;
  let subject;
  let heading;
  let intro;
  if (event === 'admin_new_order') {
    to = process.env.ADMIN_EMAIL;
    subject = `New PALMZ order ${number}`;
    heading = 'A new order was placed';
    intro = `${order.customerName} placed a new ${order.paymentProvider || 'WhatsApp'} order.`;
  } else if (event === 'paystack_receipt') {
    subject = `Payment received for PALMZ order ${number}`;
    heading = 'Payment received';
    intro = `Your Paystack payment for order ${number} has been confirmed.`;
  } else if (event === 'status_confirmed') {
    subject = `Your PALMZ order ${number} is confirmed`;
    heading = 'Your order is confirmed';
    intro = 'PALMZ has confirmed your order and is preparing it.';
  } else if (event === 'status_fulfilled') {
    subject = `Your PALMZ order ${number} is fulfilled`;
    heading = 'Your order is fulfilled';
    intro = 'PALMZ has marked your order as fulfilled.';
  } else {
    throw new Error('Unknown order email event');
  }

  if (!to) throw new Error(event === 'admin_new_order' ? 'ADMIN_EMAIL is not configured' : 'Order email address is missing');

  let adminUrl = '';
  if (event === 'admin_new_order' && process.env.APP_URL) {
    try {
      adminUrl = new URL('/admin/orders', process.env.APP_URL).toString();
    } catch {}
  }
  const customerDetails = event === 'admin_new_order'
    ? `<p><strong>Customer:</strong> ${escapeHtml(order.customerName)}<br><strong>Email:</strong> ${escapeHtml(order.email)}<br><strong>Phone:</strong> ${escapeHtml(order.phone || '')}</p>`
    : '';
  const adminLink = adminUrl
    ? `<p><a href="${escapeHtml(adminUrl)}">Open admin orders</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f5ef;color:#11141c;font-family:Arial,sans-serif"><main style="max-width:600px;margin:auto;padding:24px;background:#fff"><p style="font-weight:bold;letter-spacing:3px">PALMZ</p><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(intro)}</p><p><strong>Order:</strong> ${escapeHtml(number)}<br><strong>${escapeHtml(delivery)}</strong><br><strong>Total:</strong> ${escapeHtml(total)}</p>${customerDetails}<h2>Items</h2><ul>${itemHtml}</ul>${adminLink}</main></body></html>`;
  const text = [
    'PALMZ',
    heading,
    intro,
    `Order: ${number}`,
    delivery,
    `Total: ${total}`,
    ...(event === 'admin_new_order' ? [`Customer: ${order.customerName}`, `Email: ${order.email}`, `Phone: ${order.phone || ''}`] : []),
    'Items:',
    itemText,
    adminUrl ? `Admin orders: ${adminUrl}` : '',
  ].filter(Boolean).join('\n');

  return { to, subject, html, text };
}

async function sendOrderEmail(event, order) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('RESEND_API_KEY and EMAIL_FROM must be configured');
  const message = buildOrderEmail(event, order);
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `palmz-${String(order._id)}-${event}`,
    },
    body: JSON.stringify({ from, ...message }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
}

module.exports = { buildOrderEmail, sendOrderEmail };