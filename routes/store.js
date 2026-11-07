const express = require('express');
const deliveryController = require('../controllers/deliveryController');
const promoController = require('../controllers/promoController');
const productController = require('../controllers/productController');
const { promoValidateLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.get('/delivery-options', deliveryController.listDeliveryOptions);
router.post('/api/promo/validate', promoValidateLimiter, promoController.validatePromo);
router.get('/api/products', productController.listProducts);

module.exports = router;
