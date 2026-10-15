function variantStockKey(color, size) {
  return `${encodeURIComponent(String(color)).replace(/\./g, '%2E').replace(/\$/g, '%24')}__${String(size)}`;
}

function groupOrderItems(items) {
  const grouped = new Map();
  for (const item of items) {
    const key = `${item.productId}:${variantStockKey(item.color, item.size)}`;
    const current = grouped.get(key) || {
      productId: item.productId,
      color: item.color,
      size: item.size,
      quantity: 0,
    };
    current.quantity += item.quantity;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

module.exports = { groupOrderItems, variantStockKey };