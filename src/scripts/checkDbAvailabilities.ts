import { Database } from '../config/database';
import HourlyHelperLocationAvailability from '../models/HourlyHelperLocationAvailability';
import mongoose from 'mongoose';

async function check() {
  await Database.connectToDb();
  const all = await HourlyHelperLocationAvailability.find({}).lean();
  console.log(`\nFound ${all.length} records in HourlyHelperLocationAvailability:\n`);
  for (const r of all) {
    console.log(`- type: ${r.locationType} | id: ${r.locationId} | enabled: ${r.isEnabled} | updatedBy: ${r.updatedBy}`);
  }
  await mongoose.disconnect();
}
check();
