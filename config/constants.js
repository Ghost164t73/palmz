const ORDER_EMAIL_EVENTS = new Set([
  'admin_new_order',
  'paystack_receipt',
  'status_confirmed',
  'status_preparing',
  'status_ready_for_pickup',
  'status_dispatched',
  'status_out_for_delivery',
  'status_delivered',
  'status_fulfilled',
  'late_payment_after_cancellation',
  'admin_late_payment_after_cancellation',
]);

const SALES_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'dispatched', 'out_for_delivery', 'delivered', 'fulfilled'];

const NEXT_ORDER_STATUSES = {
  pending_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'fulfilled', 'cancelled'],
  preparing: ['dispatched', 'ready_for_pickup', 'fulfilled', 'cancelled'],
  ready_for_pickup: ['fulfilled', 'cancelled'],
  dispatched: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  fulfilled: [],
  cancelled: [],
};

const RESERVATION_HOLD_MS = {
  paystack: 2 * 60 * 60 * 1000,
  whatsapp: 24 * 60 * 60 * 1000,
};

const PICKUP_BRANCHES = {
  'shop-tos-06': { name: 'Shop TOS-06', address: 'Block C Plaza, Tarauni shopping complex, along Government House', city: 'Kano', available: true },
  'shop-1': { name: 'Shop 1', address: 'Genesis Plaza, NTA Roundabout', city: 'Lokoja, Kogi State', available: true },
  'shop-2': { name: 'Shop 2', address: 'Dews Plaza, Phase 3', city: 'Kubwa, Abuja', available: true },
  'shop-3': { name: 'Shop 3', address: 'Location to be confirmed', city: '', available: false },
};

const COOKIE = 'palmz_admin';

const CUSTOMER_COOKIE = 'palmz_customer';

module.exports = {
  ORDER_EMAIL_EVENTS,
  SALES_STATUSES,
  NEXT_ORDER_STATUSES,
  RESERVATION_HOLD_MS,
  PICKUP_BRANCHES,
  COOKIE,
  CUSTOMER_COOKIE,
};
