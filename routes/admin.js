const express = require('express');
const adminAuthController = require('../controllers/adminAuthController');
const promoController = require('../controllers/promoController');
const deliveryController = require('../controllers/deliveryController');
const adminUserController = require('../controllers/adminUserController');
const adminOrderController = require('../controllers/adminOrderController');
const productController = require('../controllers/productController');
const { loginLimiter } = require('../middleware/rateLimiters');
const { requireAdmin } = require('../middleware/auth');
const { uploadProductImages } = require('../middleware/uploads');
const { validId, validPromoId } = require('../utils/validation');

const router = express.Router();

router.post('/api/admin/login', loginLimiter, adminAuthController.login);
router.post('/api/admin/logout', adminAuthController.logout);
router.get('/api/admin/me', requireAdmin, adminAuthController.me);
router.get('/api/admin/promos', requireAdmin, promoController.listPromos);
router.get('/api/admin/delivery-zones', requireAdmin, deliveryController.listZones);
router.post('/api/admin/delivery-zones', requireAdmin, deliveryController.createZone);
router.put('/api/admin/delivery-zones/:id', requireAdmin, deliveryController.updateZone);
router.delete('/api/admin/delivery-zones/:id', requireAdmin, deliveryController.deleteZone);
router.get('/api/admin/users', requireAdmin, adminUserController.listUsers);
router.post('/api/admin/promos', requireAdmin, promoController.createPromo);
router.put('/api/admin/promos/:id', requireAdmin, validPromoId, promoController.updatePromo);
router.patch('/api/admin/promos/:id/active', requireAdmin, validPromoId, promoController.setPromoActive);
router.delete('/api/admin/promos/:id', requireAdmin, validPromoId, promoController.deletePromo);
router.get('/api/admin/promos/:id/orders', requireAdmin, validPromoId, promoController.listPromoOrders);
router.get('/api/admin/orders', requireAdmin, adminOrderController.listOrders);
router.patch('/api/admin/orders/:id/delivery', requireAdmin, adminOrderController.updateDelivery);
router.patch('/api/admin/orders/:id/payment', requireAdmin, adminOrderController.updatePayment);
router.get('/api/admin/sales', requireAdmin, adminOrderController.salesReport);
router.patch('/api/admin/orders/:id', requireAdmin, adminOrderController.updateStatus);
router.post('/api/admin/products', requireAdmin, uploadProductImages, productController.createProduct);
router.put('/api/admin/products/:id', requireAdmin, validId, uploadProductImages, productController.updateProduct);
router.patch('/api/admin/products/:id/stock', requireAdmin, validId, productController.updateStock);
router.delete('/api/admin/products/:id', requireAdmin, validId, productController.deleteProduct);

module.exports = router;
