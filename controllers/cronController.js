const crypto = require('crypto');
const { expireOrderReservations } = require('../services/orders');

// GET /api/cron/expire-order-reservations
const expireReservations = async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const authorization = req.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  const providedBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.set('Cache-Control', 'no-store');
  const expiredReservations = await expireOrderReservations();
  res.json({ expiredReservations });
};

module.exports = {
  expireReservations,
};
