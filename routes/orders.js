const express = require('express');
const cronController = require('../controllers/cronController');
const orderController = require('../controllers/orderController');
const paymentController = require('../controllers/paymentController');
const { guestOrderLimiter, paystackOrderLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.get('/api/cron/expire-order-reservations', cronController.expireReservations);
router.post('/api/orders', guestOrderLimiter, orderController.createGuestOrder);
router.post('/api/orders/paystack', guestOrderLimiter, paystackOrderLimiter, paymentController.createGuestPaystackOrder);
router.get('/paystack/callback', paymentController.paystackCallback);
router.post('/api/paystack/webhook', paymentController.paystackWebhook);

module.exports = router;
