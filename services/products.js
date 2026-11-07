const { bad, int } = require('../utils/validation');

function readFields(b) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('Name is required');
  const sizeMin = int(b.sizeMin, 20, 60, 'Smallest size');
  const sizeMax = int(b.sizeMax, 20, 60, 'Largest size');
  if (sizeMin > sizeMax) throw bad('Smallest size cannot be bigger than the largest size');
  let price = null;
  if (String(b.price ?? '').trim() !== '') {
    price = Number(b.price);
    if (!(price >= 0)) throw bad('Price must be a positive number (or leave it empty)');
  }
  const colors = String(b.colors || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  return {
    name,
    type: String(b.type || '').trim() || 'Palm',
    desc: String(b.desc || '').trim(),
    colors: colors.length ? colors : ['Standard'],
    price,
    sizeMin,
    sizeMax,
    quantity: int(b.quantity, 0, 100000, 'Quantity'),
    available: b.available === true || b.available === 'true',
  };
}

module.exports = {
  readFields,
};
