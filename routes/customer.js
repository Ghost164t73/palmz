const express = require('express');
const customerAuthController = require('../controllers/customerAuthController');
const customerAccountController = require('../controllers/customerAccountController');
const orderController = require('../controllers/orderController');
const paymentController = require('../controllers/paymentController');
const { customerLoginLimiter, paystackOrderLimiter } = require('../middleware/rateLimiters');
const { requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.get('/api/customer/google-config', customerAuthController.googleConfig);
router.post('/api/customer/google', customerLoginLimiter, customerAuthController.googleSignIn);
router.post('/api/customer/signup', customerLoginLimiter, customerAuthController.signup);
router.post('/api/customer/login', customerLoginLimiter, customerAuthController.login);
router.get('/api/customer/me', requireCustomer, customerAuthController.me);
router.post('/api/customer/logout', customerAuthController.logout);
router.get('/api/customer/orders', requireCustomer, customerAccountController.listOrders);
router.get('/api/customer/rewards', requireCustomer, customerAccountController.rewards);
router.post('/api/customer/orders', requireCustomer, orderController.createCustomerOrder);
router.post('/api/customer/orders/paystack', requireCustomer, paystackOrderLimiter, paymentController.createCustomerPaystackOrder);

module.exports = router;
