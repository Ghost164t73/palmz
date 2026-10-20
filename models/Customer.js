const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true },
    picture: { type: String, default: '' },
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
    delete ret.createdAt;
    delete ret.updatedAt;
    return ret;
  },
});

module.exports = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
