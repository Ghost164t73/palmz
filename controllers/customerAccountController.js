const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { SALES_STATUSES } = require('../config/constants');

// GET /api/customer/orders
const listOrders = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const orders = await Order.find({ customer: req.customerId }).select('-emailNotifications -promo.usageKeys').sort({ createdAt: -1 }).limit(50).lean();
  res.json({ orders });
};

// GET /api/customer/rewards
const rewards = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const customer = await Customer.findById(req.customerId).select('rewardNotificationsSeen');
  if (!customer) return res.status(401).json({ error: 'Please sign in' });
  const orders = await Order.find({
    customer: req.customerId,
    paymentStatus: 'paid',
    status: { $in: SALES_STATUSES },
  }).select('items createdAt').sort({ createdAt: 1 }).lean();
  const pairPrices = [];
  for (const order of orders) {
    for (const item of order.items || []) {
      const price = Number(item.unitPrice);
      if (!Number.isFinite(price) || price <= 0) continue;
      for (let i = 0; i < Math.max(0, Number(item.quantity) || 0); i += 1) pairPrices.push(price);
    }
  }
  const milestone = Math.floor(pairPrices.length / 5);
  const seenMilestones = Number(customer.rewardNotificationsSeen) || 0;
  let newlyEarned = false;
  let rewardPriceLimit = null;
  if (milestone > seenMilestones) {
    const group = pairPrices.slice((milestone - 1) * 5, milestone * 5);
    rewardPriceLimit = group.length ? Math.max(...group) : null;
    const update = await Customer.updateOne({
      _id: customer._id,
      $or: [
        { rewardNotificationsSeen: { $lt: milestone } },
        { rewardNotificationsSeen: { $exists: false } },
      ],
    }, { $set: { rewardNotificationsSeen: milestone } });
    newlyEarned = update.modifiedCount > 0;
  }
  const earnedPairs = pairPrices.length;
  res.json({
    earnedPairs,
    pairsToNextReward: earnedPairs % 5 === 0 ? 0 : 5 - (earnedPairs % 5),
    earnedRewards: milestone,
    newlyEarned,
    rewardPriceLimit,
  });
};

module.exports = {
  listOrders,
  rewards,
};
