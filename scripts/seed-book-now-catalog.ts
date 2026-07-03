/**
 * Seed Book Now catalog matching extrahand-mobile-app package data.
 * Run: npx ts-node scripts/seed-book-now-catalog.ts
 */
import mongoose from 'mongoose';
import { BookNowCatalogBootstrap } from '../src/services/BookNowCatalogBootstrap';

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/extrahand';
  await mongoose.connect(mongoUri);

  const result = await BookNowCatalogBootstrap.run();
  console.log('Book Now catalog seeded:', result);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
