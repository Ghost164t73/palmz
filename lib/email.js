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

function formatMoney(value) {
  return Number(value).toLocaleString('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildOrderEmail(event, order) {
  const number = orderNumber(order);
  const isAdmin = ['admin_new_order', 'admin_late_payment_after_cancellation'].includes(event);
  let to = isAdmin ? process.env.ADMIN_EMAIL : order.email;
  let subject;
  let heading;
  let intro;
  if (isAdmin) {
    if (event === 'admin_late_payment_after_cancellation') {
      subject = `Action needed: late payment for PALMZ order ${number}`;
      heading = 'Payment received after the order was cancelled';
      intro = `Paystack confirmed payment for ${order.customerName}'s order after its stock reservation expired. Contact the customer to resolve the order or arrange a refund.`;
    } else {
      subject = `New PALMZ order ${number}`;
      heading = 'A new order was placed';
      intro = `${order.customerName} placed a new ${order.paymentProvider || 'WhatsApp'} order.`;
    }
  } else if (event === 'paystack_receipt') {
    subject = `Thank you for your PALMZ order ${number}`;
    heading = 'Thank you for your order';
    intro = 'We have received your order and confirmed your Paystack payment. Your order is now being processed. Here is a summary for your records.';
  } else if (event === 'late_payment_after_cancellation') {
    subject = `Please contact PALMZ about your payment for order ${number}`;
    heading = 'Your payment was received after the order expired';
    intro = 'Your payment was received after the order was cancelled. Please contact PALMZ with your order number so we can help resolve this. The cancelled order will not be dispatched automatically.';
  } else if (event === 'status_confirmed') {
    subject = `Your PALMZ order ${number} is confirmed`;
    heading = 'Your order is confirmed';
    intro = 'PALMZ has confirmed your order and is preparing it. Here is a summary for your records.';
  } else if (event === 'status_preparing') {
    subject = `PALMZ is preparing your order ${number}`;
    heading = 'Your order is being prepared';
    intro = 'PALMZ is preparing your order. We will update you as it moves through delivery.';
  } else if (event === 'status_dispatched') {
    subject = `Your PALMZ order ${number} has been dispatched`;
    heading = 'Your order has been dispatched';
    intro = 'Your order has left PALMZ and is on its way to you.';
  } else if (event === 'status_out_for_delivery') {
    subject = `Your PALMZ order ${number} is out for delivery`;
    heading = 'Your order is out for delivery';
    intro = 'Your order is with the delivery team and is on its way to your address.';
  } else if (event === 'status_delivered') {
    subject = `Your PALMZ order ${number} has been delivered`;
    heading = 'Your order has been delivered';
    intro = 'PALMZ has marked your order as delivered. Thank you for shopping with us.';
  } else if (event === 'status_fulfilled') {
    subject = `Your PALMZ order ${number} is fulfilled`;
    heading = 'Your order has been fulfilled';
    intro = 'PALMZ has marked your order as fulfilled. Here is a summary for your records.';
  } else {
    throw new Error('Unknown order email event');
  }

  if (!to) throw new Error(isAdmin ? 'ADMIN_EMAIL is not configured' : 'Order email address is missing');

  const customerName = String(order.customerName || 'there');
  const items = order.items || [];
  const pricesKnown = items.length > 0 && items.every((item) => item.unitPrice != null && Number.isFinite(Number(item.unitPrice)));
  const subtotal = pricesKnown
    ? items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0)
    : null;
  const total = order.totalAmount == null ? null : Number(order.totalAmount);
  const itemRowsHtml = items.map((item) => {
    const productDescription = [
      item.name,
      item.size ? `Size ${item.size}` : '',
      item.color || '',
    ].filter(Boolean).map(escapeHtml).join(' · ');
    const lineTotal = item.unitPrice == null
      ? 'To be confirmed'
      : formatMoney(Number(item.unitPrice) * Number(item.quantity));
    return `<tr><td style="padding:12px 8px;border-bottom:1px solid #e8e5dc">${productDescription}</td><td style="padding:12px 8px;border-bottom:1px solid #e8e5dc;text-align:center;white-space:nowrap">${Number(item.quantity)}</td><td style="padding:12px 8px;border-bottom:1px solid #e8e5dc;text-align:right;white-space:nowrap">${escapeHtml(lineTotal)}</td></tr>`;
  }).join('') || '<tr><td colspan="3" style="padding:12px 8px">No item details</td></tr>';
  const itemRowsText = items.map((item) => {
    const description = [item.name, item.size ? `Size ${item.size}` : '', item.color || ''].filter(Boolean).join(' · ');
    const lineTotal = item.unitPrice == null
      ? 'To be confirmed'
      : formatMoney(Number(item.unitPrice) * Number(item.quantity));
    return `${description} | Qty ${Number(item.quantity)} | ${lineTotal}`;
  });
  const orderDate = order.createdAt
    ? new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(order.createdAt))
    : '';
  const isPickup = order.fulfillmentMethod === 'pickup';
  const fulfillmentLabel = isPickup ? 'Pickup details' : 'Delivery details';
  const fulfillmentLines = (isPickup
    ? [order.customerName, order.pickupBranchName, order.pickupBranchAddress, order.city]
    : [order.customerName, order.streetAddress || order.address, order.area && `Area: ${order.area}`, order.landmark && `Nearby landmark: ${order.landmark}`, order.city]).filter(Boolean);
  if (order.phone) fulfillmentLines.push(`Phone: ${order.phone}`);
  if (order.email) fulfillmentLines.push(`Email: ${order.email}`);
  const fulfillmentHtml = fulfillmentLines.map(escapeHtml).join('<br>') || 'PALMZ will confirm the details with you.';
  const fulfillmentText = fulfillmentLines.join('\n') || 'PALMZ will confirm the details with you.';
  const deliveryFee = Number(order.deliveryFee || 0);
  const promo = order.promo || null;
  const promoDiscount = promo ? Number(promo.totalDiscount || 0) : 0;
  const promoRowHtml = promoDiscount > 0
    ? `<tr><td style="padding:5px 0;color:#555b64">Promo ${escapeHtml(promo.code)}</td><td align="right" style="padding:5px 0">−${escapeHtml(formatMoney(promoDiscount))}</td></tr>`
    : '';
  const paymentMethod = order.paymentProvider === 'paystack'
    ? `Paystack${order.paymentStatus === 'paid' ? ' · Paid' : ''}`
    : 'WhatsApp order · PALMZ will confirm payment details';
  const supportEmail = process.env.SUPPORT_EMAIL || '';
  const supportHtml = supportEmail
    ? `If you need help with your order, contact us at <a href="mailto:${encodeURIComponent(supportEmail)}" style="color:#85651f">${escapeHtml(supportEmail)}</a>.`
    : 'If you need help with your order, contact PALMZ through our usual support channel.';
  const supportText = supportEmail
    ? `If you need help with your order, contact us at ${supportEmail}.`
    : 'If you need help with your order, contact PALMZ through our usual support channel.';

  let adminUrl = '';
  if (isAdmin && process.env.APP_URL) {
    try {
      adminUrl = new URL('/admin/orders', process.env.APP_URL).toString();
    } catch {}
  }
  const customerDetails = isAdmin
    ? `<p><strong>Customer:</strong> ${escapeHtml(customerName)}<br><strong>Email:</strong> ${escapeHtml(order.email)}<br><strong>Phone:</strong> ${escapeHtml(order.phone || '')}</p>`
    : '';
  const adminLink = adminUrl
    ? `<p><a href="${escapeHtml(adminUrl)}">Open admin orders</a></p>`
    : '';
  const html = isAdmin
    ? `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f5ef;color:#11141c;font-family:Arial,sans-serif"><main style="max-width:600px;margin:auto;padding:24px;background:#fff"><p style="font-weight:bold;letter-spacing:3px">PALMZ</p><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(intro)}</p><p><strong>Order:</strong> ${escapeHtml(number)}<br><strong>Total:</strong> ${escapeHtml(total == null ? 'To be confirmed' : formatMoney(total))}</p>${customerDetails}<ul>${items.map((item) => `<li>${Number(item.quantity)} × ${escapeHtml(item.name)} · size ${escapeHtml(item.size)} · ${escapeHtml(item.color)}</li>`).join('')}</ul>${adminLink}</main></body></html>`
    : `<!doctype html><html lang="en"><body style="margin:0;padding:0;background:#f4f2ec;color:#17191d;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2ec;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border:1px solid #e9e6de"><tr><td style="padding:28px 28px 12px"><div style="font-size:13px;font-weight:700;letter-spacing:3px;color:#0c1227">PALMZ</div><h1 style="margin:22px 0 16px;font-family:Georgia,serif;font-size:30px;line-height:1.2">${escapeHtml(heading)}</h1><p style="margin:0 0 12px;font-size:15px;line-height:1.6">Hi ${escapeHtml(customerName)},</p><p style="margin:0;color:#555b64;font-size:14px;line-height:1.7">${escapeHtml(intro)}</p></td></tr><tr><td style="padding:16px 28px 8px"><h2 style="margin:0 0 6px;font-size:18px">Order summary</h2><p style="margin:0 0 14px;color:#687078;font-size:13px">Order #${escapeHtml(number)}${orderDate ? ` · ${escapeHtml(orderDate)}` : ''}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#f7f5ef;color:#555b64"><th align="left" style="padding:10px 8px;font-size:11px">Product</th><th align="center" style="padding:10px 8px;font-size:11px">Qty</th><th align="right" style="padding:10px 8px;font-size:11px">Price</th></tr></thead><tbody>${itemRowsHtml}</tbody></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;font-size:13px"><tr><td style="padding:5px 0;color:#555b64">Subtotal</td><td align="right" style="padding:5px 0">${escapeHtml(subtotal == null ? 'To be confirmed' : formatMoney(subtotal))}</td></tr>${promoRowHtml}<tr><td style="padding:5px 0;color:#555b64">${isPickup ? 'Pickup' : 'Delivery'}</td><td align="right" style="padding:5px 0">${escapeHtml(formatMoney(deliveryFee))}</td></tr><tr><td style="padding:12px 0 4px;border-top:1px solid #e8e5dc;font-size:15px;font-weight:700">Total</td><td align="right" style="padding:12px 0 4px;border-top:1px solid #e8e5dc;font-size:15px;font-weight:700">${escapeHtml(total == null ? 'To be confirmed' : formatMoney(total))}</td></tr></table><p style="margin:12px 0 0;color:#555b64;font-size:12px">Payment method: ${escapeHtml(paymentMethod)}</p></td></tr><tr><td style="padding:22px 28px 8px"><h2 style="margin:0 0 8px;font-size:17px">${escapeHtml(fulfillmentLabel)}</h2><p style="margin:0;color:#555b64;font-size:13px;line-height:1.7">${fulfillmentHtml}</p></td></tr><tr><td style="padding:8px 28px 26px"><p style="margin:0;color:#555b64;font-size:13px;line-height:1.7">${supportHtml}</p><p style="margin:18px 0 0;color:#687078;font-size:12px">Thanks again for choosing PALMZ.</p></td></tr></table></td></tr></table></body></html>`;
  const text = [
    'PALMZ',
    heading,
    ...(isAdmin ? [intro, `Order: ${number}`, `Total: ${total == null ? 'To be confirmed' : formatMoney(total)}`, `Customer: ${customerName}`, `Email: ${order.email}`, `Phone: ${order.phone || ''}`, ...itemRowsText] : [
      `Hi ${customerName},`,
      intro,
      '',
      'ORDER SUMMARY',
      `Order #${number}${orderDate ? ` (${orderDate})` : ''}`,
      ...itemRowsText,
      `Subtotal: ${subtotal == null ? 'To be confirmed' : formatMoney(subtotal)}`,
      ...(promoDiscount > 0 ? [`Promo ${promo.code}: -${formatMoney(promoDiscount)}`] : []),
      `${isPickup ? 'Pickup' : 'Delivery'}: ${formatMoney(deliveryFee)}`,
      `Total: ${total == null ? 'To be confirmed' : formatMoney(total)}`,
      `Payment method: ${paymentMethod}`,
      '',
      fulfillmentLabel.toUpperCase(),
      fulfillmentText,
      '',
      supportText,
      'Thanks again for choosing PALMZ.',
    ]),
    adminUrl ? `Admin orders: ${adminUrl}` : '',
  ].filter(Boolean).join('\n');

  return { to, subject, html, text };
}

async function sendOrderEmail(event, order) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  if (!from) throw new Error('EMAIL_FROM is not configured');
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
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const reason = result && typeof result.message === 'string' ? result.message.slice(0, 300) : 'No provider details returned';
    throw new Error(`Resend returned HTTP ${response.status}: ${reason}`);
  }
}

async function sendCustomizationEmail(request, image) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = process.env.ADMIN_EMAIL;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  if (!from) throw new Error('EMAIL_FROM is not configured');
  if (!to) throw new Error('ADMIN_EMAIL is not configured');

  const fields = [
    ['Customer', request.name],
    ['Email', request.email],
    ['Phone / WhatsApp', request.phone],
    ['Shoe style', request.shoeStyle],
    ['Size', request.size],
    ['Colors', request.colors],
    ['Material / finish', request.material],
    ['Budget range', request.budget],
    ['Date needed by', request.neededBy],
    ['Design details', request.details],
    ['Reference image description', request.imageDescription],
  ].filter(([, value]) => value);
  const htmlRows = fields.map(([label, value]) =>
    `<tr><th align="left" style="padding:10px 12px;border-bottom:1px solid #e8e5dc;vertical-align:top">${escapeHtml(label)}</th><td style="padding:10px 12px;border-bottom:1px solid #e8e5dc;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`
  ).join('');
  const text = ['PALMZ CUSTOM SHOE REQUEST', '', ...fields.map(([label, value]) => `${label}:\n${value}`)].join('\n\n');
  const attachments = image ? [{
    filename: image.originalname,
    content_type: image.mimetype,
    content: image.buffer.toString('base64'),
  }] : undefined;
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      reply_to: request.email,
      subject: `PALMZ custom shoe request from ${request.name}`,
      html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f5ef;color:#11141c;font-family:Arial,sans-serif"><main style="max-width:680px;margin:auto;padding:24px;background:#fff"><p style="font-weight:bold;letter-spacing:3px">PALMZ</p><h1>Custom shoe request</h1><p>A customer submitted a shoe customization request. This is not an order.</p><table style="width:100%;border-collapse:collapse">${htmlRows}</table>${image ? `<p>The reference image is attached: ${escapeHtml(image.originalname)}</p>` : '<p>No reference image was attached.</p>'}</main></body></html>`,
      text,
      ...(attachments ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const reason = result && typeof result.message === 'string' ? result.message.slice(0, 300) : 'No provider details returned';
    throw new Error(`Resend returned HTTP ${response.status}: ${reason}`);
  }
}

module.exports = { buildOrderEmail, sendOrderEmail, sendCustomizationEmail };
