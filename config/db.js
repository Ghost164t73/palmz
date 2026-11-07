const DeliveryZone = require('../models/DeliveryZone');
const mongoose = require('mongoose');
const { DELIVERY_TIERS } = require('../lib/delivery');

let cached = global._palmzMongo || (global._palmzMongo = { conn: null, promise: null });

async function connectDb() {
  if (cached.conn) return cached.conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  cached.promise = cached.promise || mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 25000,
    connectTimeoutMS: 20000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    w: 'majority',
  });
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}

async function ensureDeliveryZones() {
  await connectDb();
  let zones = await DeliveryZone.find().sort({ name: 1 }).lean();
  if (zones.length) return zones;
  try {
    await DeliveryZone.insertMany(DELIVERY_TIERS.map((tier) => ({ ...tier, active: true })));
  } catch (error) {
    if (!error || error.code !== 11000) throw error;
  }
  zones = await DeliveryZone.find().sort({ name: 1 }).lean();
  return zones;
}

module.exports = {
  connectDb,
  ensureDeliveryZones,
};
