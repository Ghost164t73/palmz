const mongoose = require('mongoose');

const ORDER_STATUSES = ['pending_confirmation', 'confirmed', 'fulfilled', 'cancelled'];

const OrderItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: String, required: true },
    color: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, default: null },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    source: { type: String, enum: ['guest', 'account'], required: true, default: 'guest' },
    customerName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    items: { type: [OrderItemSchema], required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_confirmation' },
    paymentProvider: { type: String, enum: ['whatsapp', 'paystack'], default: 'whatsapp' },
    paymentStatus: { type: String, enum: ['not_started', 'pending', 'paid', 'failed', 'refunded'], default: 'not_started' },
  },
  { timestamps: true }
);

OrderSchema.index({ customer: 1, createdAt: -1 });

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);
Order.ORDER_STATUSES = ORDER_STATUSES;
module.exports = Order;
