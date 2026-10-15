const test = require('node:test');
const assert = require('node:assert/strict');
const { groupOrderItems, variantStockKey } = require('../lib/inventory');

test('inventory groups duplicate order lines by exact product, color, and size', () => {
  const grouped = groupOrderItems([
    { productId: 'product-a', color: 'Black', size: '43', quantity: 1 },
    { productId: 'product-a', color: 'Black', size: '43', quantity: 2 },
    { productId: 'product-a', color: 'Tan', size: '43', quantity: 1 },
    { productId: 'product-b', color: 'Black', size: '43', quantity: 1 },
  ]);

  assert.deepEqual(grouped, [
    { productId: 'product-a', color: 'Black', size: '43', quantity: 3 },
    { productId: 'product-a', color: 'Tan', size: '43', quantity: 1 },
    { productId: 'product-b', color: 'Black', size: '43', quantity: 1 },
  ]);
});

test('variant stock keys encode dots so they remain safe Mongo field paths', () => {
  assert.equal(variantStockKey('$Black.Edge', '43'), '%24Black%2EEdge__43');
});