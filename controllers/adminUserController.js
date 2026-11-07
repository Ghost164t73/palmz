const Customer = require('../models/Customer');
const Order = require('../models/Order');

// GET /api/admin/users
const listUsers = async (req, res) => {
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
  const search = String(req.query.search || '').trim().slice(0, 100);
  const filter = {};
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
    ];
  }
  const [total, customers] = await Promise.all([
    Customer.countDocuments(filter),
    Customer.find(filter).select('name email picture createdAt').sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const customerIds = customers.map((customer) => customer._id);
  const orderCounts = customerIds.length
    ? await Order.aggregate([
      { $match: { customer: { $in: customerIds } } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ])
    : [];
  const countsByCustomer = new Map(orderCounts.map((entry) => [String(entry._id), entry.count]));
  res.set('Cache-Control', 'no-store');
  res.json({
    users: customers.map((customer) => ({
      id: String(customer._id), name: customer.name, email: customer.email,
      picture: customer.picture || '', createdAt: customer.createdAt,
      orderCount: countsByCustomer.get(String(customer._id)) || 0,
    })),
    page, limit, total,
  });
};

module.exports = {
  listUsers,
};
