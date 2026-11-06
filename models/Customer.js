const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
  {
    // Present for Google sign-in accounts; email/password accounts may not have one.
    googleId: { type: String, unique: true, sparse: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    picture: { type: String, default: '' },
    // scrypt hash for email/password accounts; never returned by default.
    passwordHash: { type: String, select: false },
    rewardNotificationsSeen: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

CustomerSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.googleId;
    delete ret.passwordHash;
    delete ret.createdAt;
    delete ret.updatedAt;
    return ret;
  },
});

module.exports = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
