import mongoose from 'mongoose';
import { BookNowCatalogBootstrap } from '../services/BookNowCatalogBootstrap';

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/extrahand';
  const dbName = process.env.MONGODB_DB || 'extrahand';
  await mongoose.connect(mongoUri, { dbName });

  try {
    const result = await BookNowCatalogBootstrap.deactivateFullHomeDeepClean();
    console.log('Full Home Deep Clean catalog item deactivated:', result);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Failed to deactivate Full Home Deep Clean catalog item:', error);
  process.exitCode = 1;
});
