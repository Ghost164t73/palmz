const express = require('express');
const path = require('path');
const { requireAdminPage } = require('../middleware/auth');

const pagesDir = path.join(__dirname, '..', 'pages');
const publicDir = path.join(__dirname, '..', 'public');
const page = (file) => (req, res) => res.sendFile(path.join(pagesDir, file));

const router = express.Router();

router.get('/admin', page('admin.html'));
router.use('/admin', requireAdminPage);
router.get('/admin/orders', page('orders.html'));
router.get('/admin/sales', page('sales.html'));
router.get('/admin/promos', page('promos.html'));
router.get('/admin/users', page('users.html'));
router.get('/admin/delivery', page('delivery.html'));
router.get('/terms', page('terms.html'));
router.get('/privacy', page('privacy.html'));
router.get(['/signin', '/signup'], page('signin.html'));
router.get(['/shop', '/cart', '/checkout', '/about', '/contact', '/customize', '/product/:id'], page('index.html'));
router.use(['/orders.html', '/sales.html', '/promos.html', '/users.html', '/delivery.html'], requireAdminPage);
router.use(express.static(pagesDir));
router.use(express.static(publicDir));

module.exports = router;
