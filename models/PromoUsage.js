const mongoose = require('mongoose');

// One row per (promo, customer identity key). Incremented atomically when an order
// reserves a code, so the per-customer limit holds under simultaneous requests.
const PromoUsageSchema = new mongoose.Schema(
  {
    promoId: { type: mongoose.Schema.Types.ObjectId, required: true },
    key: { type: String, required: true }, // acct:<id> | email:<address> | phone:<last 10 digits>
    count: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);
PromoUsageSchema.index({ promoId: 1, key: 1 }, { unique: true });

module.exports = mongoose.models.PromoUsage || mongoose.model('PromoUsage', PromoUsageSchema);
