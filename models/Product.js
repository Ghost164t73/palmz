const mongoose = require('mongoose');

const ImageSchema = new mongoose.Schema(
  { url: { type: String, required: true }, publicId: String },
  { _id: false }
);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, trim: true, default: 'Palm', maxlength: 40 }, // category, used for storefront filters
    desc: { type: String, trim: true, default: '', maxlength: 400 },
    colors: { type: [String], default: ['Standard'] },
    price: { type: Number, min: 0, default: null }, // null = "Price via WhatsApp"
    sizeMin: { type: Number, required: true, min: 20, max: 60 },
    sizeMax: { type: Number, required: true, min: 20, max: 60 },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    available: { type: Boolean, default: true }, // manual on/off switch
    image: { url: String, publicId: String },
    images: { type: [ImageSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = String(ret._id);
        const primaryImage = ret.image && ret.image.url ? ret.image.url : '';
        ret.images = (ret.images || []).map((image) => image.url).filter(Boolean);
        ret.image = ret.images[0] || primaryImage;
        if (!ret.images.length && ret.image) ret.images = [ret.image];
        delete ret._id;
        delete ret.__v;
        delete ret.createdAt;
        delete ret.updatedAt;
        return ret;
      },
    },
  }
);

// e.g. sizeMin 43, sizeMax 48 -> ["43","44","45","46","47","48"]
ProductSchema.virtual('sizes').get(function () {
  const out = [];
  for (let s = this.sizeMin; s <= this.sizeMax; s++) out.push(String(s));
  return out;
});

// what the storefront uses: switched on AND something left
ProductSchema.virtual('inStock').get(function () {
  return this.available && this.quantity > 0;
});

module.exports = mongoose.models.Product || mongoose.model('Product', ProductSchema);
