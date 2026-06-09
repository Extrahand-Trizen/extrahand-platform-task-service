/**
 * Seed initial Book Now catalog (cleaning). Run: npx ts-node scripts/seed-book-now-catalog.ts
 */
import mongoose from 'mongoose';
import ServiceCategory from '../src/models/ServiceCategory';
import ServiceSku from '../src/models/ServiceSku';
import ServiceVariant from '../src/models/ServiceVariant';
import ServiceAddon from '../src/models/ServiceAddon';
import ServiceArea from '../src/models/ServiceArea';

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/extrahand';
  await mongoose.connect(mongoUri);

  const category = await ServiceCategory.findOneAndUpdate(
    { slug: 'home-cleaning' },
    {
      slug: 'home-cleaning',
      name: 'Home Cleaning',
      description: 'Professional home cleaning services',
      sortOrder: 1,
      isActive: true,
    },
    { upsert: true, new: true }
  );

  const sku = await ServiceSku.findOneAndUpdate(
    { categoryId: category._id, slug: 'standard-cleaning' },
    {
      categoryId: category._id,
      slug: 'standard-cleaning',
      name: 'Standard Home Cleaning',
      description: 'Sweeping, mopping, dusting, bathroom & kitchen cleaning',
      basePrice: 499,
      pricingUnit: 'fixed',
      durationMinutes: 120,
      taskCategory: 'cleaning',
      isActive: true,
    },
    { upsert: true, new: true }
  );

  await ServiceVariant.findOneAndUpdate(
    { skuId: sku._id, slug: '1bhk' },
    {
      skuId: sku._id,
      slug: '1bhk',
      name: '1 BHK',
      priceDelta: 0,
      durationDeltaMinutes: 0,
      isDefault: true,
      isActive: true,
    },
    { upsert: true, new: true }
  );

  await ServiceVariant.findOneAndUpdate(
    { skuId: sku._id, slug: '2bhk' },
    {
      skuId: sku._id,
      slug: '2bhk',
      name: '2 BHK',
      priceDelta: 200,
      durationDeltaMinutes: 60,
      isDefault: false,
      isActive: true,
    },
    { upsert: true, new: true }
  );

  await ServiceAddon.findOneAndUpdate(
    { skuId: sku._id, slug: 'balcony-cleaning' },
    {
      skuId: sku._id,
      slug: 'balcony-cleaning',
      name: 'Balcony Cleaning',
      price: 99,
      isActive: true,
    },
    { upsert: true, new: true }
  );

  await ServiceArea.findOneAndUpdate(
    { city: 'Bengaluru' },
    {
      city: 'Bengaluru',
      pinCodes: ['560001', '560034', '560038', '560103'],
      isActive: true,
    },
    { upsert: true, new: true }
  );

  console.log('Book Now catalog seeded:', {
    category: category.slug,
    sku: sku.slug,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
