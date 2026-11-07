const express = require('express');
const customizeController = require('../controllers/customizeController');
const { customizationLimiter } = require('../middleware/rateLimiters');
const { customizationUpload } = require('../middleware/uploads');

const router = express.Router();

router.post('/api/customize', customizationLimiter, customizationUpload, customizeController.createCustomizationRequest);

module.exports = router;
