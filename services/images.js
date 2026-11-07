const cloudinary = require('../config/cloudinary');
const { bad } = require('../utils/validation');

const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: 'palmz', resource_type: 'image' }, (err, result) => (err ? reject(err) : resolve(result)))
      .end(buffer);
  });

const removeFromCloudinary = (publicId) => (publicId ? cloudinary.uploader.destroy(publicId).catch(() => {}) : null);

function productImageFiles(req) {
  const fields = req.files || {};
  const files = [...(fields.images || []), ...(fields.image || [])];
  if (files.length > 12) throw bad('Choose no more than 12 product photos');
  if (files.reduce((total, file) => total + file.size, 0) > 4 * 1024 * 1024) {
    throw bad('Product photos must total no more than 4MB');
  }
  return files;
}

async function uploadProductGallery(files) {
  const images = [];
  try {
    for (const file of files) {
      const img = await uploadToCloudinary(file.buffer);
      images.push({ url: img.secure_url, publicId: img.public_id });
    }
    return images;
  } catch (err) {
    await Promise.all(images.map((image) => removeFromCloudinary(image.publicId)));
    throw err;
  }
}

function productImagePublicIds(product) {
  return [...new Set([
    product.image && product.image.publicId,
    ...(product.images || []).map((image) => image.publicId),
  ].filter(Boolean))];
}

module.exports = {
  uploadToCloudinary,
  removeFromCloudinary,
  productImageFiles,
  uploadProductGallery,
  productImagePublicIds,
};
