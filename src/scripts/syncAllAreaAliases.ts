import { Database } from '../config/database';
import { HourlyHelperLocationAvailabilityService } from '../services/HourlyHelperLocationAvailabilityService';
import HourlyHelperLocationAvailability from '../models/HourlyHelperLocationAvailability';
import LocationArea from '../models/LocationArea';
import mongoose from 'mongoose';

async function syncAll() {
  await Database.connectToDb();

  // Find all current explicit records
  const records = await HourlyHelperLocationAvailability.find({}).lean();
  console.log(`Current explicit records: ${records.length}`);

  for (const r of records) {
    if (r.locationType === 'area') {
      const locIdStr = String(r.locationId);
      // Call setLocationAvailability to ensure all alias forms are synchronized
      await HourlyHelperLocationAvailabilityService.setLocationAvailability({
        locationType: 'area',
        locationId: locIdStr,
        isEnabled: r.isEnabled,
        updatedBy: r.updatedBy || 'admin',
      });
    }
  }

  console.log('✅ Synchronized all area alias records in DB.');
  await mongoose.disconnect();
}
syncAll();
