const path = require('path');
const { sendCustomizationEmail } = require('../lib/email');
const { bad } = require('../utils/validation');
const { safeEmailError } = require('../services/orderEmails');

// POST /api/customize
const createCustomizationRequest = async (req, res) => {
  const body = req.body || {};
  if (String(body.website || '').trim()) return res.status(200).json({ ok: true });
  const request = {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    phone: String(body.phone || '').trim(),
    shoeStyle: String(body.shoeStyle || '').trim(),
    size: String(body.size || '').trim(),
    colors: String(body.colors || '').trim(),
    material: String(body.material || '').trim(),
    budget: String(body.budget || '').trim(),
    neededBy: String(body.neededBy || '').trim(),
    details: String(body.details || '').trim(),
    imageDescription: String(body.imageDescription || '').trim(),
  };
  if (!request.name || request.name.length > 100) throw bad('Enter your name (up to 100 characters)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email) || request.email.length > 254) throw bad('Enter a valid email address');
  if (!request.phone || request.phone.length > 40) throw bad('Enter your phone or WhatsApp number (up to 40 characters)');
  if (!request.shoeStyle || request.shoeStyle.length > 100) throw bad('Tell us the shoe style you want (up to 100 characters)');
  if (!request.size || request.size.length > 40) throw bad('Enter your shoe size or size range (up to 40 characters)');
  if (request.colors.length > 120 || request.material.length > 160 || request.budget.length > 80) throw bad('One of the design fields is too long');
  if (request.neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(request.neededBy)) throw bad('Choose a valid target date');
  if (!request.details || request.details.length < 10 || request.details.length > 3000) throw bad('Describe your design in 10 to 3000 characters');
  if (request.imageDescription.length > 500) throw bad('Image description must be 500 characters or fewer');

  const image = req.file ? {
    ...req.file,
    originalname: path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'reference-image',
  } : null;
  try {
    await sendCustomizationEmail(request, image);
  } catch (error) {
    console.error('Custom shoe request email failed', { reason: safeEmailError(error) });
    return res.status(502).json({ error: 'We could not send your request right now. Please try again shortly.' });
  }
  res.status(201).json({ ok: true, message: 'Your custom shoe request has been sent to PALMZ.' });
};

module.exports = {
  createCustomizationRequest,
};
