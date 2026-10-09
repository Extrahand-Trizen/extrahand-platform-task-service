import { Database } from '../config/database';
import { HourlyHelperLocationAvailabilityService } from '../services/HourlyHelperLocationAvailabilityService';
import mongoose from 'mongoose';

async function testToggle() {
  await Database.connectToDb();

  console.log('1. Setting Ameerpet to ENABLED in portal...');
  await HourlyHelperLocationAvailabilityService.setLocationAvailability({
    locationType: 'area',
    locationId: '6ac8afefd5d8636a57e50792',
    isEnabled: true,
    updatedBy: 'admin'
  });
  const checkEnabled = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Ameerpet',
    cityName: 'Hyderabad'
  });
  console.log('👉 App status when ENABLED in portal:', checkEnabled ? '✅ AVAILABLE' : '⛔ COMING SOON');

  console.log('\n2. Setting Ameerpet to DISABLED in portal...');
  await HourlyHelperLocationAvailabilityService.setLocationAvailability({
    locationType: 'area',
    locationId: '6ac8afefd5d8636a57e50792',
    isEnabled: false,
    updatedBy: 'admin'
  });
  const checkDisabled = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Ameerpet',
    cityName: 'Hyderabad'
  });
  console.log('👉 App status when DISABLED in portal:', checkDisabled ? '✅ AVAILABLE' : '⛔ COMING SOON');

  await mongoose.disconnect();
}
testToggle();
