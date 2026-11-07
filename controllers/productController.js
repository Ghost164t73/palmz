const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { variantStockKey } = require('../lib/inventory');
const { bad, int } = require('../utils/validation');
const { completeVariantStock, expireOrderReservations } = require('../services/orders');
const { productImageFiles, productImagePublicIds, removeFromCloudinary, uploadProductGallery } = require('../services/images');
const { readFields } = require('../services/products');

// GET /api/products
const listProducts = async (req, res) => {
  await expireOrderReservations();
  const products = await Product.find().sort({ createdAt: 1 });
  res.set('Cache-Control', 'no-store');
  res.json({ products, whatsapp: process.env.WHATSAPP_NUMBER || '' });
};

// POST /api/admin/products
const createProduct = async (req, res) => {
  const data = readFields(req.body);
  const files = productImageFiles(req);
  if (!files.length) throw bad('Please choose at least one product image');
  const images = await uploadProductGallery(files);
  try {
    const p = await Product.create({ ...data, image: images[0], images });
    res.status(201).json(p);
  } catch (e) {
    await Promise.all(images.map((image) => removeFromCloudinary(image.publicId)));
    throw e;
  }
};

// PUT /api/admin/products/:id
const updateProduct = async (req, res) => {
  const files = productImageFiles(req);
  const images = files.length ? await uploadProductGallery(files) : null;
  let p;
  let removedImageIds = [];
  try {
    await mongoose.connection.transaction(async (session) => {
      p = await Product.findById(req.params.id).session(session);
      if (!p) throw Object.assign(new Error('Product not found'), { status: 404, expose: true });
      const hasReservation = await Order.exists({
        inventoryReserved: true,
        'items.productId': String(p._id),
      }).session(session);
      if (hasReservation) throw bad('This product has an active order reservation. Confirm or cancel that order before editing the product.');

      const data = readFields(req.body);
      const sameVariants = p.sizeMin === data.sizeMin && p.sizeMax === data.sizeMax && JSON.stringify(p.colors) === JSON.stringify(data.colors);
      data.stockByVariant = sameVariants ? p.stockByVariant : {};
      data.stockBySize = sameVariants ? p.stockBySize : {};
      const currentImages = p.images && p.images.length ? [...p.images] : (p.image && p.image.url ? [p.image] : []);
      let retainedImages;
      if (req.body.retainedImages !== undefined) {
        let requestedUrls;
        try { requestedUrls = JSON.parse(req.body.retainedImages); }
        catch { throw bad('The selected product photos are invalid. Please review them and try again.'); }
        if (!Array.isArray(requestedUrls) || requestedUrls.length > 12 || requestedUrls.some((url) => typeof url !== 'string')) {
          throw bad('The selected product photos are invalid. Please review them and try again.');
        }
        if (new Set(requestedUrls).size !== requestedUrls.length) throw bad('A product photo cannot be selected more than once');
        const imagesByUrl = new Map(currentImages.map((image) => [image.url, image]));
        retainedImages = requestedUrls.map((url) => {
          const image = imagesByUrl.get(url);
          if (!image) throw bad('A saved photo could not be found. Reload the page and try again.');
          return image;
        });
      } else {
        // Keep compatibility with admin clients that still replace images on upload.
        retainedImages = files.length ? [] : currentImages;
      }
      const nextImages = [...retainedImages, ...(images || [])];
      if (!nextImages.length) throw bad('A product must have at least one photo');
      if (nextImages.length > 12) throw bad('A product can have no more than 12 photos');
      data.images = nextImages;
      data.image = nextImages[0];
      const nextPublicIds = new Set(nextImages.map((image) => image.publicId).filter(Boolean));
      removedImageIds = productImagePublicIds(p).filter((publicId) => !nextPublicIds.has(publicId));
      p.set(data);
      await p.save({ session });
    });
  } catch (error) {
    if (images) await Promise.all(images.map((image) => removeFromCloudinary(image.publicId)));
    throw error;
  }
  await Promise.all(removedImageIds.map(removeFromCloudinary));
  res.json(p);
};

// PATCH /api/admin/products/:id/stock
const updateStock = async (req, res) => {
  let p;
  await mongoose.connection.transaction(async (session) => {
    p = await Product.findById(req.params.id).session(session);
    if (!p) throw Object.assign(new Error('Product not found'), { status: 404, expose: true });
    const b = req.body || {};
    const hasVariant = b.size !== undefined || b.color !== undefined;
    if (hasVariant) {
      const size = String(b.size);
      const color = String(b.color);
      if (!p.sizes.includes(size)) throw bad('Choose a size within this product range');
      if (!p.colors.includes(color)) throw bad('Choose a color for this product');
      const map = completeVariantStock(p);
      const key = variantStockKey(color, size);
      const current = map.get(key) || 0;
      const next = b.quantity !== undefined
        ? int(b.quantity, 0, 100000, 'Quantity')
        : current + int(b.delta, -100000, 100000, 'Stock change');
      if (next < 0) throw bad('Stock cannot be reduced below zero');
      const amount = next - current;
      map.set(key, next);
      p.stockByVariant = map;
      p.stockBySize = {};
      if (amount) p.stockHistory.push({ color, size, quantity: amount, reason: b.quantity !== undefined ? 'manual adjustment' : amount > 0 ? 'stock received' : 'manual adjustment', createdAt: new Date() });
      p.quantity = [...map.values()].reduce((sum, n) => sum + n, 0);
    } else {
      if (b.quantity !== undefined) p.quantity = int(b.quantity, 0, 100000, 'Quantity');
      if (b.delta !== undefined) p.quantity = Math.max(0, p.quantity + int(b.delta, -1000, 1000, 'Change'));
    }
    if (b.available !== undefined) p.available = b.available === true || b.available === 'true';
    await p.save({ session });
  });
  res.json(p);
};

// DELETE /api/admin/products/:id
const deleteProduct = async (req, res) => {
  let p;
  await mongoose.connection.transaction(async (session) => {
    const hasReservation = await Order.exists({
      inventoryReserved: true,
      'items.productId': String(req.params.id),
    }).session(session);
    if (hasReservation) throw bad('This product has an active order reservation. Confirm or cancel that order before deleting the product.');
    p = await Product.findByIdAndDelete(req.params.id, { session });
  });
  if (!p) return res.status(404).json({ error: 'Product not found' });
  await Promise.all(productImagePublicIds(p).map(removeFromCloudinary));
  res.json({ ok: true });
};

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
};
