import { Database } from '../config/database';
import { HourlyHelperLocationAvailabilityService } from '../services/HourlyHelperLocationAvailabilityService';
import mongoose from 'mongoose';

async function run() {
  await Database.connectToDb();
  const list = await HourlyHelperLocationAvailabilityService.listLocationAvailabilities({});
  console.log(`\n================================================================================`);
  console.log(`📌 TOTAL PORTAL LOCATIONS: ${list.length}`);
  console.log(`================================================================================`);
  
  const table = list.map((l, i) => ({
    '#': i + 1,
    'Location Name': l.displayName,
    'Portal Status': l.isEnabled ? '🟢 ENABLED' : '🔴 DISABLED',
    'Active Helpers': l.eligibleHelperCount,
    'Location ID': l.locationId,
  }));

  console.table(table);

  // Check Ameerpet specifically
  const ameerpet = list.find(l => l.canonicalName === 'ameerpet');
  console.log('👉 Ameerpet Portal Status:', ameerpet ? (ameerpet.isEnabled ? '🟢 ENABLED' : '🔴 DISABLED') : 'NOT FOUND');

  const isAmeerpetEnabledForAddress = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Ameerpet',
    cityName: 'Hyderabad'
  });
  console.log('👉 Customer App Address Check for Ameerpet:', isAmeerpetEnabledForAddress ? '✅ AVAILABLE' : '⛔ DISABLED (COMING SOON)');

  await mongoose.disconnect();
}
run();
