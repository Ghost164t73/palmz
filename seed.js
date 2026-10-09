// One-off: loads the 4 starter palms (images included) into MongoDB + Cloudinary.
// Run once with:  npm run seed   (does nothing if products already exist)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const Product = require('./models/Product');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  if (await Product.countDocuments()) {
    console.log('Products already exist, nothing to seed.');
    return process.exit(0);
  }
  const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'products.json'), 'utf8'));
  for (const it of items) {
    const img = await cloudinary.uploader.upload(path.join(__dirname, 'seed', it.file), { folder: 'palmz' });
    const { file, ...rest } = it;
    const image = { url: img.secure_url, publicId: img.public_id };
    await Product.create({ ...rest, image, images: [image] });
    console.log('Added', it.name);
  }
  console.log('Done. Starter quantities are 10 each: update them in /admin.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
