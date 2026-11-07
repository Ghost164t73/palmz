const Order = require('../models/Order');
const { sendOrderEmail } = require('../lib/email');
const { ORDER_EMAIL_EVENTS } = require('../config/constants');

function safeEmailError(error) {
  return String(error && error.message || 'Unknown email error')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bre_[A-Za-z0-9_-]+\b/g, '[redacted key]')
    .slice(0, 400);
}

async function notifyOrderEmail(order, event) {
  if (!ORDER_EMAIL_EVENTS.has(event)) return;
  if (event === 'status_ready_for_pickup' && order.fulfillmentMethod !== 'pickup') return;
  if (event === 'status_delivered' && order.fulfillmentMethod !== 'delivery') return;
  const eventPath = `emailNotifications.${event}`;
  const statusPath = `${eventPath}.status`;
  const attemptPath = `${eventPath}.attemptedAt`;
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  let claimed;
  try {
    claimed = await Order.findOneAndUpdate({
      _id: order._id,
      $or: [
        { [statusPath]: { $exists: false } },
        { [statusPath]: { $in: ['pending', 'failed'] } },
        { [statusPath]: 'sending', [attemptPath]: { $lt: staleBefore } },
      ],
    }, {
      $set: { [statusPath]: 'sending', [attemptPath]: new Date() },
    }, { new: true });
  } catch {
    console.error('Could not claim order email notification', { event, orderId: String(order._id) });
    return;
  }
  if (!claimed) return;

  try {
    await sendOrderEmail(event, claimed);
    await Order.updateOne({ _id: claimed._id, [statusPath]: 'sending' }, {
      $set: { [statusPath]: 'sent', [`${eventPath}.sentAt`]: new Date() },
    });
  } catch (error) {
    await Order.updateOne({ _id: claimed._id, [statusPath]: 'sending' }, {
      $set: { [statusPath]: 'failed' },
    }).catch(() => {});
    console.error('Order email notification failed', {
      event,
      orderId: String(order._id),
      reason: safeEmailError(error),
    });
  }
}

module.exports = {
  safeEmailError,
  notifyOrderEmail,
};
