const DeliveryZone = require('../models/DeliveryZone');
const { bad } = require('../utils/validation');

function readDeliveryZoneFields(body) {
  const name = String(body.name || '').trim();
  const states = (Array.isArray(body.states) ? body.states : String(body.states || '').split(','))
    .map((state) => String(state).trim()).filter(Boolean);
  const fee = Number(body.fee);
  const estimate = String(body.estimate || '').trim();
  if (!name || name.length > 100) throw bad('Enter a zone name of 1 to 100 characters');
  if (!states.length || states.length > 40 || states.some((state) => state.length > 80)) throw bad('Enter 1 to 40 valid state names');
  if (new Set(states.map((state) => state.toLocaleLowerCase('en'))).size !== states.length) throw bad('A state can only appear once in a zone');
  if (!Number.isFinite(fee) || fee < 0 || fee > 10000000) throw bad('Enter a delivery fee between 0 and 10,000,000');
  if (!estimate || estimate.length > 120) throw bad('Enter a delivery estimate of 1 to 120 characters');
  const cityOverrides = Array.isArray(body.cityOverrides) ? body.cityOverrides.map((entry) => ({
    city: String(entry && entry.city || '').trim(), fee: Number(entry && entry.fee),
    estimate: String(entry && entry.estimate || '').trim(),
  })).filter((entry) => entry.city) : [];
  if (cityOverrides.length > 30 || cityOverrides.some((entry) => entry.city.length > 100 || !Number.isFinite(entry.fee) || entry.fee < 0 || entry.fee > 10000000 || entry.estimate.length > 120)) throw bad('Check each city exception and its fee and estimate');
  if (new Set(cityOverrides.map((entry) => entry.city.toLocaleLowerCase('en'))).size !== cityOverrides.length) throw bad('A city exception can only appear once in a zone');
  return { name, states, fee, estimate, cityOverrides, active: body.active !== false };
}

async function assertDeliveryStatesAvailable(fields, ignoreId = null) {
  const zones = await DeliveryZone.find(ignoreId ? { _id: { $ne: ignoreId } } : {}).select('states').lean();
  const assigned = new Set(zones.flatMap((zone) => zone.states).map((state) => state.toLocaleLowerCase('en')));
  if (fields.states.some((state) => assigned.has(state.toLocaleLowerCase('en')))) throw bad('A state is already assigned to another delivery zone');
}

module.exports = {
  readDeliveryZoneFields,
  assertDeliveryStatesAvailable,
};
