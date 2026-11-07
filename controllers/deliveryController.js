const DeliveryZone = require('../models/DeliveryZone');
const mongoose = require('mongoose');
const { assertDeliveryStatesAvailable, readDeliveryZoneFields } = require('../services/deliveryZones');
const { bad } = require('../utils/validation');
const { ensureDeliveryZones } = require('../config/db');

// GET /delivery-options
const listDeliveryOptions = async (req, res) => {
  const zones = await ensureDeliveryZones();
  res.set('Cache-Control', 'no-store');
  res.json({ tiers: zones.filter((zone) => zone.active) });
};

// GET /api/admin/delivery-zones
const listZones = async (req, res) => {
  const zones = await ensureDeliveryZones();
  res.set('Cache-Control', 'no-store');
  res.json({ zones });
};

// POST /api/admin/delivery-zones
const createZone = async (req, res) => {
  const fields = readDeliveryZoneFields(req.body || {});
  await assertDeliveryStatesAvailable(fields);
  try {
    const zone = await DeliveryZone.create(fields);
    res.status(201).json({ zone });
  } catch (error) {
    if (error && error.code === 11000) throw bad('A delivery zone with this name already exists');
    throw error;
  }
};

// PUT /api/admin/delivery-zones/:id
const updateZone = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Delivery zone not found' });
  const fields = readDeliveryZoneFields(req.body || {});
  await assertDeliveryStatesAvailable(fields, req.params.id);
  let zone;
  try {
    zone = await DeliveryZone.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true, runValidators: true });
  } catch (error) {
    if (error && error.code === 11000) throw bad('A delivery zone with this name already exists');
    throw error;
  }
  if (!zone) return res.status(404).json({ error: 'Delivery zone not found' });
  res.json({ zone });
};

// DELETE /api/admin/delivery-zones/:id
const deleteZone = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Delivery zone not found' });
  if (await DeliveryZone.countDocuments() <= 1) throw bad('Keep at least one delivery zone configured');
  const zone = await DeliveryZone.findByIdAndDelete(req.params.id);
  if (!zone) return res.status(404).json({ error: 'Delivery zone not found' });
  res.json({ ok: true });
};

module.exports = {
  listDeliveryOptions,
  listZones,
  createZone,
  updateZone,
  deleteZone,
};
