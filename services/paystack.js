const Order = require('../models/Order');
const crypto = require('crypto');
const { expectedPaymentAmountKobo, paymentAmountMismatchDetails, paystackTransactionMismatches } = require('../lib/paystack');
const { bad } = require('../utils/validation');
const { createReservedOrder, expireOrderReservations, orderContact, releaseOrderReservation } = require('./orders');
const { notifyOrderEmail } = require('./orderEmails');

async function createPaystackOrder(req, account = null) {
  if (!process.env.PAYSTACK_SECRET_KEY || !process.env.APP_URL) {
    throw Object.assign(new Error('Online payment is not configured. Choose WhatsApp checkout or contact PALMZ.'), {
      status: 503,
      expose: true,
    });
  }
  if (process.env.NODE_ENV === 'production' && !process.env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
    throw Object.assign(new Error('Live Paystack payments require a live secret key. Update PAYSTACK_SECRET_KEY in the server environment.'), {
      status: 503,
      expose: true,
    });
  }
  let appUrl;
  try {
    appUrl = new URL(process.env.APP_URL);
  } catch {
    throw Object.assign(new Error('Online payment is not configured correctly. Contact PALMZ.'), {
      status: 503,
      expose: true,
    });
  }
  if (!['https:', 'http:'].includes(appUrl.protocol) ||
      (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:')) {
    throw Object.assign(new Error('Online payment requires a valid secure APP_URL.'), {
      status: 503,
      expose: true,
    });
  }

  await expireOrderReservations();
  const orderData = await orderContact(req.body || {}, account, 'paystack');
  if (orderData.items.some((item) => item.unitPrice == null)) {
    throw bad('Online payment is unavailable for an item without a set price. Choose WhatsApp checkout instead.');
  }
  const amountKobo = Math.round(orderData.totalAmount * 100);
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 ||
      Math.abs(amountKobo / 100 - orderData.totalAmount) > 1e-7) {
    throw bad('The order total cannot be processed online. Choose WhatsApp checkout instead.');
  }

  const order = new Order({
    ...orderData,
    paymentAmountKobo: amountKobo,
  });
  const reference = `palmz-${order._id}-${crypto.randomBytes(8).toString('hex')}`;
  order.paystackReference = reference;
  await createReservedOrder(order);

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: order.email,
        amount: amountKobo,
        currency: 'NGN',
        reference,
        callback_url: new URL('/paystack/callback', appUrl).toString(),
        metadata: { orderId: String(order._id) },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.status !== true || !data.data?.authorization_url) {
      throw new Error(data && data.message ? data.message : 'Paystack did not return a checkout link');
    }
    const authorizationUrl = new URL(data.data.authorization_url);
    if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'checkout.paystack.com') {
      throw new Error('Paystack returned an invalid checkout URL');
    }
    return authorizationUrl.toString();
  } catch (error) {
    await releaseOrderReservation(order._id, {
      paymentStatus: 'failed',
      reason: 'Paystack initialization failed',
    }).catch((releaseError) => {
      console.error('Could not release failed Paystack order reservation', { orderId: String(order._id), message: releaseError.message });
    });
    console.error('Paystack initialization failed:', error.message);
    throw Object.assign(new Error('Could not start Paystack checkout. Please try again or choose WhatsApp checkout.'), {
      status: 502,
      expose: true,
    });
  }
}

async function verifyPaystackTransaction(reference) {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  if (process.env.NODE_ENV === 'production' && !process.env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
    throw new Error('Live Paystack payment verification requires a live secret key');
  }
  const order = await Order.findOne({ paystackReference: reference });
  if (!order) throw new Error('Paystack reference does not match an order');
  if (order.paymentStatus === 'refunded') return order.paymentStatus;
  if (order.paymentStatus === 'paid') {
    if (order.status === 'cancelled') return 'paid_after_cancellation';
    await Promise.all([
      notifyOrderEmail(order, 'admin_new_order'),
      notifyOrderEmail(order, 'paystack_receipt'),
    ]);
    return order.paymentStatus;
  }

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.status !== true || !result.data) {
    throw new Error(result && result.message ? result.message : 'Paystack could not verify the transaction');
  }
  return applyPaystackTransaction(order, result.data, reference);
}

async function applyPaystackTransaction(order, transaction, reference) {
  const mismatches = paystackTransactionMismatches(order, transaction, reference);
  if (mismatches.length) {
    const details = mismatches.includes('amount')
      ? paymentAmountMismatchDetails(order, transaction)
      : null;
    throw Object.assign(new Error(`Paystack transaction ${mismatches.join(', ')} did not match order ${order._id}${details ? ` (order requested ${details.expectedKobo} kobo, Paystack requested ${details.requestedKobo} kobo, customer charged ${details.receivedKobo} kobo)` : ''}`), { code: 'PAYSTACK_TRANSACTION_MISMATCH' });
  }
  if (transaction.status === 'success') {
    const paidOrder = await Order.findOneAndUpdate({
      _id: order._id,
      status: { $ne: 'cancelled' },
      paymentStatus: { $nin: ['paid', 'refunded'] },
    }, {
      $set: {
        paymentStatus: 'paid',
        paidAmountKobo: Number(transaction.amount),
        paystackFeeKobo: Number(transaction.amount) - expectedPaymentAmountKobo(order),
      },
    }, { new: true });
    let currentOrder = paidOrder || await Order.findById(order._id);
    if (!paidOrder && currentOrder && currentOrder.status === 'cancelled' && currentOrder.paymentStatus !== 'paid') {
      currentOrder = await Order.findOneAndUpdate({
        _id: currentOrder._id,
        status: 'cancelled',
        paymentStatus: { $nin: ['paid', 'refunded'] },
      }, { $set: {
        paymentStatus: 'paid',
        paidAmountKobo: Number(transaction.amount),
        paystackFeeKobo: Number(transaction.amount) - expectedPaymentAmountKobo(order),
      } }, { new: true }) || await Order.findById(order._id);
      if (currentOrder && currentOrder.paymentStatus === 'paid') {
        console.error('Paystack payment arrived after the order reservation expired; manual follow-up required', {
          orderId: String(currentOrder._id),
        });
        await Promise.all([
          notifyOrderEmail(currentOrder, 'admin_late_payment_after_cancellation'),
          notifyOrderEmail(currentOrder, 'late_payment_after_cancellation'),
        ]);
        return 'paid_after_cancellation';
      }
    }
    if (currentOrder && currentOrder.paymentStatus === 'paid') {
      if (currentOrder.status === 'cancelled') return 'paid_after_cancellation';
      await Promise.all([
        notifyOrderEmail(currentOrder, 'admin_new_order'),
        notifyOrderEmail(currentOrder, 'paystack_receipt'),
      ]);
      return 'paid';
    }
    return currentOrder ? currentOrder.paymentStatus : 'pending';
  }
  if (['failed', 'abandoned'].includes(transaction.status)) {
    const released = await releaseOrderReservation(order._id, {
      paymentStatus: 'failed',
      reason: 'Paystack payment failed',
      onlyUnpaid: true,
    });
    if (!released) {
      await Order.updateOne({
        _id: order._id,
        paymentStatus: { $nin: ['paid', 'refunded'] },
      }, { $set: { paymentStatus: 'failed', status: 'cancelled' } });
    }
    const currentOrder = await Order.findById(order._id);
    return currentOrder ? currentOrder.paymentStatus : 'failed';
  }
  return order.paymentStatus;
}

module.exports = {
  createPaystackOrder,
  verifyPaystackTransaction,
  applyPaystackTransaction,
};
