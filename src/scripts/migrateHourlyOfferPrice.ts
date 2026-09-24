import 'dotenv/config';
import mongoose from 'mongoose';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';

async function run(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'extrahand' });
  try {
    const category = await ServiceCategory.findOne({ slug: 'hourly-helper' }).select('_id').lean();
    if (!category) {
      console.log('Hourly Helper category not found; nothing to migrate.');
      return;
    }

    const result = await ServiceSku.updateMany(
      {
        categoryId: category._id,
        pricingUnit: 'hourly',
        offerPrice: { $exists: false },
      },
      { $set: { offerPrice: 0 } },
    );

    console.log(`Hourly offerPrice migration complete. Updated ${result.modifiedCount} SKU(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});