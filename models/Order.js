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

const SaleEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['sale', 'reversal'], required: true },
    status: { type: String, default: '' },
    items: { type: [OrderItemSchema], default: [] },
    reverses: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
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
    fulfillmentMethod: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
    deliveryState: { type: String, default: '' },
    deliveryFee: { type: Number, min: 0, default: 0 },
    deliveryEstimate: { type: String, default: '' },
    totalAmount: { type: Number, min: 0, default: null },
    pickupBranchId: { type: String, default: '' },
    pickupBranchName: { type: String, default: '' },
    pickupBranchAddress: { type: String, default: '' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    items: { type: [OrderItemSchema], required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_confirmation' },
    inventoryDeducted: { type: Boolean, default: false },
    salesHistory: { type: [SaleEventSchema], default: [] },
    paymentProvider: { type: String, enum: ['whatsapp', 'paystack'], default: 'whatsapp' },
    paymentStatus: { type: String, enum: ['not_started', 'pending', 'paid', 'failed', 'refunded'], default: 'not_started' },
    paymentAmountKobo: { type: Number, min: 1, default: null },
    paidAmountKobo: { type: Number, min: 1, default: null },
    paystackFeeKobo: { type: Number, min: 0, default: null },
    paymentReference: { type: String, trim: true, maxlength: 120, default: '' },
    paystackReference: { type: String, default: undefined },
  },
  { timestamps: true }
);

OrderSchema.index({ customer: 1, createdAt: -1 });
OrderSchema.index({ paystackReference: 1 }, { unique: true, sparse: true });

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);
Order.ORDER_STATUSES = ORDER_STATUSES;
module.exports = Order;
