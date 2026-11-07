require('dotenv').config();
const express = require('express');

const { securityHeaders, jsonBody } = require('./middleware/security');
const { requireDatabase } = require('./middleware/database');
const { apiNotFound, errorHandler, wrapAsyncRoutes } = require('./middleware/errors');

const customizeRoutes = require('./routes/customize');
const storeRoutes = require('./routes/store');
const customerRoutes = require('./routes/customer');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const pageRoutes = require('./routes/pages');

const app = express();
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(jsonBody);

// Custom shoe requests only send an email, so they run before the database connects.
app.use(customizeRoutes);
app.use('/api', requireDatabase);

app.use(storeRoutes);
app.use(customerRoutes);
app.use(orderRoutes);
app.use(adminRoutes);
app.use(pageRoutes);

wrapAsyncRoutes(app._router.stack);
app.use('/api', apiNotFound);
app.use(errorHandler);

module.exports = app;
