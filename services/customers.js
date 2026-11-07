const Customer = require('../models/Customer');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client();

let customerIndexesPromise = null;

function ensureCustomerIndexes() {
  customerIndexesPromise = customerIndexesPromise || (async () => {
    const indexes = await Customer.collection.indexes().catch(() => []);
    const googleIndex = indexes.find((index) => index.key && index.key.googleId === 1 && Object.keys(index.key).length === 1);
    if (googleIndex && !googleIndex.sparse) await Customer.collection.dropIndex(googleIndex.name);
    if (!googleIndex || !googleIndex.sparse) await Customer.collection.createIndex({ googleId: 1 }, { unique: true, sparse: true });
  })().catch((error) => { customerIndexesPromise = null; throw error; });
  return customerIndexesPromise;
}

module.exports = {
  googleClient,
  ensureCustomerIndexes,
};
