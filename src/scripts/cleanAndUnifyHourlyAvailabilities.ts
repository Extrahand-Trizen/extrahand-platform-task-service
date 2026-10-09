import { Database } from '../config/database';
import HourlyHelperLocationAvailability from '../models/HourlyHelperLocationAvailability';
import LocationArea from '../models/LocationArea';
import { canonicalServiceAreaName } from '../utils/hourlyHelperServiceArea';
import mongoose from 'mongoose';

async function unify() {
  await Database.connectToDb();

  const allRecords = await HourlyHelperLocationAvailability.find({}).lean();
  console.log(`Current DB records count: ${allRecords.length}`);

  // Find all area records
  for (const rec of allRecords) {
    console.log(`- type: ${rec.locationType} | id: ${rec.locationId} | enabled: ${rec.isEnabled}`);
  }

  // Remove duplicate string records if ObjectId exists, OR normalize all records
  // Let's delete the raw string records for Ameerpet and Madhapur if an ObjectId exists
  const ameerpetArea = await LocationArea.findOne({ displayName: /ameerpet/i }).lean();
  if (ameerpetArea) {
    // Delete duplicate string records
    await HourlyHelperLocationAvailability.deleteMany({
      locationType: 'area',
      locationId: { $in: ['Ameerpet', 'ameerpet'] },
    });
    console.log(`Deleted duplicate string records for Ameerpet`);
  }

  const madhapurArea = await LocationArea.findOne({ displayName: /madhapur/i }).lean();
  if (madhapurArea) {
    await HourlyHelperLocationAvailability.deleteMany({
      locationType: 'area',
      locationId: 'Madhapur',
    });
    console.log(`Deleted duplicate string records for Madhapur`);
  }

  const remaining = await HourlyHelperLocationAvailability.find({}).lean();
  console.log('\nRemaining unified records:');
  for (const r of remaining) {
    console.log(`- type: ${r.locationType} | id: ${r.locationId} | enabled: ${r.isEnabled}`);
  }

  await mongoose.disconnect();
}
unify();
