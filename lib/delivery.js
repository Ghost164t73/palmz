const DELIVERY_TIERS = [
  { fee: 2000, estimate: '1-2 working days', states: ['Kano'] },
  { fee: 3500, estimate: '2-3 working days', states: ['Jigawa', 'Katsina', 'Kaduna', 'Bauchi'] },
  { fee: 5000, estimate: '3-4 working days', states: ['FCT (Abuja)', 'Plateau', 'Gombe', 'Zamfara', 'Yobe'] },
  { fee: 7000, estimate: '4-5 working days', states: ['Nasarawa', 'Niger', 'Kebbi', 'Sokoto', 'Kogi', 'Benue', 'Adamawa', 'Taraba', 'Borno'] },
  { fee: 9000, estimate: '5-6 working days', states: ['Kwara', 'Enugu', 'Ebonyi', 'Anambra', 'Edo', 'Ekiti', 'Osun', 'Oyo', 'Ondo'] },
  { fee: 11000, estimate: '5-7 working days', states: ['Lagos', 'Ogun', 'Delta', 'Imo', 'Abia', 'Rivers', 'Bayelsa', 'Akwa Ibom', 'Cross River'] },
];

function deliveryQuote(state) {
  return DELIVERY_TIERS.find((tier) => tier.states.includes(state)) || null;
}

function calculateOrderTotal(items, deliveryFee) {
  if (items.some((item) => item.unitPrice == null)) return null;
  return items.reduce((total, item) => total + item.unitPrice * item.quantity, 0) + deliveryFee;
}

module.exports = { DELIVERY_TIERS, deliveryQuote, calculateOrderTotal };
