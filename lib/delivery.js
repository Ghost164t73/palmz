const DELIVERY_TIERS = [
  { name: 'Kano', fee: 2000, estimate: '1-2 working days', states: ['Kano'] },
  { name: 'FCT (Abuja)', fee: 2000, estimate: '3-4 working days', states: ['FCT (Abuja)'] },
  { name: 'North West and North Central A', fee: 5000, estimate: '2-3 working days', states: ['Jigawa', 'Katsina', 'Kaduna', 'Bauchi'] },
  { name: 'North Central and North East B', fee: 5000, estimate: '3-4 working days', states: ['Plateau', 'Gombe', 'Zamfara', 'Yobe'] },
  { name: 'North Central and North East C', fee: 5000, estimate: '4-5 working days', states: ['Nasarawa', 'Niger', 'Kebbi', 'Sokoto', 'Kogi', 'Benue', 'Adamawa', 'Taraba', 'Borno'], cityOverrides: [{ city: 'Lokoja', fee: 2000, estimate: '4-5 working days' }] },
  { name: 'South East and South West A', fee: 5000, estimate: '5-6 working days', states: ['Kwara', 'Enugu', 'Ebonyi', 'Anambra', 'Edo', 'Ekiti', 'Osun', 'Oyo', 'Ondo'] },
  { name: 'South and South West B', fee: 5000, estimate: '5-7 working days', states: ['Lagos', 'Ogun', 'Delta', 'Imo', 'Abia', 'Rivers', 'Bayelsa', 'Akwa Ibom', 'Cross River'] },
];

function deliveryQuote(state, city = '', tiers = DELIVERY_TIERS) {
  const tier = tiers.find((candidate) => candidate.active !== false && candidate.states.includes(state));
  if (!tier) return null;
  const normalizedCity = String(city).split(',')[0].trim().toLocaleLowerCase('en');
  const override = (tier.cityOverrides || []).find((entry) => String(entry.city).trim().toLocaleLowerCase('en') === normalizedCity);
  if (override) {
    return { ...tier, fee: Number(override.fee), estimate: override.estimate || tier.estimate };
  }
  return tier;
}

function calculateOrderTotal(items, deliveryFee) {
  if (items.some((item) => item.unitPrice == null)) return null;
  return items.reduce((total, item) => total + item.unitPrice * item.quantity, 0) + deliveryFee;
}

function discountedPrice(price) {
  return price == null ? null : Number(price);
}

module.exports = { DELIVERY_TIERS, deliveryQuote, calculateOrderTotal, discountedPrice };
