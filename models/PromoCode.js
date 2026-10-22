const mongoose = require('mongoose');

const DISCOUNT_TYPES = ['percentage', 'fixed', 'free_delivery'];

const PromoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9][A-Z0-9_-]{2,29}$/ },
    description: { type: String, trim: true, maxlength: 200, default: '' }, // internal note
    discountType: { type: String, enum: DISCOUNT_TYPES, required: true },
    discountValue: { type: Number, min: 0, default: 0 }, // percent (0-100) or NGN; ignored for free_delivery
    minSubtotal: { type: Number, min: 0, default: 0 },
    maxDiscount: { type: Number, min: 0, default: null }, // percentage codes only; null = no cap
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    maxRedemptions: { type: Number, min: 1, default: null }, // null = unlimited
    perCustomerLimit: { type: Number, min: 1, default: null }, // null = unlimited
    appliesTo: { type: String, enum: ['all', 'selected'], default: 'all' },
    productIds: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    // Pending orders hold a slot (reserved); confirmed orders consume it (redeemed).
    reservedCount: { type: Number, min: 0, default: 0 },
    redeemedCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

PromoCodeSchema.index({ code: 1 }, { unique: true });
PromoCodeSchema.index({ active: 1, expiresAt: 1 });

const PromoCode = mongoose.models.PromoCode || mongoose.model('PromoCode', PromoCodeSchema);
PromoCode.DISCOUNT_TYPES = DISCOUNT_TYPES;
module.exports = PromoCode;
