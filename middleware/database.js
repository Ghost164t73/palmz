const { connectDb } = require('../config/db');

// Connects to MongoDB before any /api request runs.
async function requireDatabase(req, res, next) {
  try {
    await connectDb();
    next();
  } catch (e) {
    console.error('DB connection failed:', e.message);
    res.status(500).json({ error: 'Database connection failed. Check MONGODB_URI.' });
  }
}

module.exports = { requireDatabase };
