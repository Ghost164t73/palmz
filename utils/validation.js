const mongoose = require('mongoose');

const validPromoId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ error: 'Promo code not found' });

const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });

function int(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

function validId(req, res, next) {
  return mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ error: 'Product not found' });
}

module.exports = {
  validPromoId,
  bad,
  int,
  validId,
};
