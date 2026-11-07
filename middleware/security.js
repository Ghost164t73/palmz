const express = require('express');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

// Keeps the raw body for the Paystack webhook so its signature can be checked.
const jsonBody = express.json({
  limit: '100kb',
  verify(req, res, buffer) {
    if (req.originalUrl === '/api/paystack/webhook') req.rawBody = Buffer.from(buffer);
  },
});

module.exports = { securityHeaders, jsonBody };
