const mongoose = require('mongoose');

const CityOverrideSchema = new mongoose.Schema({
  city: { type: String, required: true, trim: true, maxlength: 100 },
  fee: { type: Number, required: true, min: 0 },
  estimate: { type: String, trim: true, maxlength: 120, default: '' },
}, { _id: false });

const DeliveryZoneSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100, unique: true },
  states: { type: [String], required: true, validate: value => value.length > 0 },
  fee: { type: Number, required: true, min: 0 },
  estimate: { type: String, required: true, trim: true, maxlength: 120 },
  cityOverrides: { type: [CityOverrideSchema], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.DeliveryZone || mongoose.model('DeliveryZone', DeliveryZoneSchema);
