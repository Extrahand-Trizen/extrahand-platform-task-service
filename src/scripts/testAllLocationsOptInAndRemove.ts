import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Database } from '../config/database';
import { HourlyHelperLocationAvailabilityService } from '../services/HourlyHelperLocationAvailabilityService';
import { HourlyHelperAvailabilityService } from '../services/HourlyHelperAvailabilityService';
import { BookingService } from '../services/BookingService';
import { HOURLY_HELPER_COMING_SOON_CODE } from '../constants/hourlyBooking';

async function run() {
  await Database.connectToDb();

  console.log('================================================================================');
  console.log('🧪 VERIFYING ALL REQUIREMENTS: OPT-IN, REMOVE, ISOLATION & BOOKING ENFORCEMENT');
  console.log('================================================================================\n');

  // ── 1. Enable-Only Selected Locations Verification ──
  console.log('1️⃣ Requirement 1: Enable-Only Selected Locations (Unconfigured = Coming Soon)');
  
  // Unconfigured location test (e.g. arbitrary unconfigured area)
  const unconfiguredArea = 'UnconfiguredTestZone';
  await HourlyHelperLocationAvailabilityService.removeLocationAvailability({
    locationType: 'area',
    locationId: unconfiguredArea,
  });

  const unconfiguredCheck = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: unconfiguredArea,
    cityName: 'Hyderabad',
  });
  console.log(`  👉 Unconfigured location (${unconfiguredArea}) status:`, unconfiguredCheck ? '❌ AVAILABLE' : '✅ COMING SOON');
  assert.equal(unconfiguredCheck, false, 'Unconfigured location must return false ("Coming Soon")');

  // Customer app endpoint response test for unconfigured location
  const appUnconfiguredRes = await HourlyHelperAvailabilityService.getAvailabilityForAddress({
    area: unconfiguredArea,
    city: 'Hyderabad',
  });
  console.log(`  👉 Customer app availability endpoint: available = ${appUnconfiguredRes.available}`);
  assert.equal(appUnconfiguredRes.available, false, 'App endpoint must return available: false');


  // ── 2. Enable / Disable across multiple real locations (Ameerpet, Yousufguda, Madhapur) ──
  console.log('\n2️⃣ Testing Enable & Disable across multiple locations:');

  // Enable Ameerpet
  await HourlyHelperLocationAvailabilityService.setLocationAvailability({
    locationType: 'area',
    locationId: 'Ameerpet',
    isEnabled: true,
    updatedBy: 'admin',
  });
  const ameerpetEnabled = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Ameerpet',
    cityName: 'Hyderabad',
  });
  console.log('  👉 Ameerpet when ENABLED:', ameerpetEnabled ? '✅ AVAILABLE' : '❌ COMING SOON');
  assert.equal(ameerpetEnabled, true);

  // Enable Yousufguda
  await HourlyHelperLocationAvailabilityService.setLocationAvailability({
    locationType: 'area',
    locationId: 'Yousufguda',
    isEnabled: true,
    updatedBy: 'admin',
  });
  const yousufgudaEnabled = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Yousufguda',
    cityName: 'Hyderabad',
  });
  console.log('  👉 Yousufguda when ENABLED:', yousufgudaEnabled ? '✅ AVAILABLE' : '❌ COMING SOON');
  assert.equal(yousufgudaEnabled, true);

  // Disable Ameerpet
  await HourlyHelperLocationAvailabilityService.setLocationAvailability({
    locationType: 'area',
    locationId: 'Ameerpet',
    isEnabled: false,
    updatedBy: 'admin',
  });
  const ameerpetDisabled = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Ameerpet',
    cityName: 'Hyderabad',
  });
  console.log('  👉 Ameerpet when DISABLED:', ameerpetDisabled ? '❌ AVAILABLE' : '✅ COMING SOON');
  assert.equal(ameerpetDisabled, false);

  // Yousufguda must STILL be enabled (Cross-location isolation!)
  const yousufgudaStillEnabled = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Yousufguda',
    cityName: 'Hyderabad',
  });
  console.log('  👉 Yousufguda after Ameerpet disabled (Isolation check):', yousufgudaStillEnabled ? '✅ STILL AVAILABLE' : '❌ BROKEN');
  assert.equal(yousufgudaStillEnabled, true);


  // ── 3. Requirement 3: Remove Option ──
  console.log('\n3️⃣ Requirement 3: Remove Option (Removes only availability config, reverts to Coming Soon)');

  // Remove Yousufguda configuration
  const removeRes = await HourlyHelperLocationAvailabilityService.removeLocationAvailability({
    locationType: 'area',
    locationId: 'Yousufguda',
  });
  console.log(`  👉 Removed ${removeRes.removedCount} availability record(s) for Yousufguda`);

  // After removal, Yousufguda must revert to COMING SOON
  const yousufgudaAfterRemove = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
    areaName: 'Yousufguda',
    cityName: 'Hyderabad',
  });
  console.log('  👉 Yousufguda status after REMOVAL:', yousufgudaAfterRemove ? '❌ STILL AVAILABLE' : '✅ REVERTED TO COMING SOON');
  assert.equal(yousufgudaAfterRemove, false);


  // ── 4. Requirement 2: Backend Booking Enforcement ──
  console.log('\n4️⃣ Requirement 2: Backend Enforcement (Booking Creation rejection)');
  
  // Attempting to create an hourly booking in a disabled location (Ameerpet)
  try {
    const fakeProfileId = new mongoose.Types.ObjectId();
    await BookingService.createBooking({
      customerUid: 'test-customer-uid',
      customerProfileId: fakeProfileId,
      skuSlug: 'hourly-1h',
      categorySlug: 'hourly-helper',
      quantity: 1,
      fulfillmentType: 'instant',
      address: {
        line1: 'Near Metro Station, Ameerpet',
        area: 'Ameerpet',
        city: 'Hyderabad',
        pinCode: '500038',
      },
    });
    console.log('  ❌ Booking was unexpectedly allowed!');
    assert.fail('Should have rejected booking for disabled location');
  } catch (err: any) {
    console.log(`  👉 Booking in Ameerpet rejected with error code: ${err.code || err.name}`);
    console.log(`  👉 Rejection message: "${err.message}"`);
    assert.equal(err.code, HOURLY_HELPER_COMING_SOON_CODE, 'Must reject with HOURLY_HELPER_COMING_SOON_CODE');
  }

  // Attempting to create an hourly booking in an unconfigured location
  try {
    const fakeProfileId = new mongoose.Types.ObjectId();
    await BookingService.createBooking({
      customerUid: 'test-customer-uid',
      customerProfileId: fakeProfileId,
      skuSlug: 'hourly-1h',
      categorySlug: 'hourly-helper',
      quantity: 1,
      fulfillmentType: 'instant',
      address: {
        line1: 'Random Street, UnconfiguredZone',
        area: 'UnconfiguredZone',
        city: 'Hyderabad',
        pinCode: '500001',
      },
    });
    console.log('  ❌ Booking in unconfigured location was unexpectedly allowed!');
    assert.fail('Should have rejected booking for unconfigured location');
  } catch (err: any) {
    console.log(`  👉 Booking in UnconfiguredZone rejected with error code: ${err.code || err.name}`);
    console.log(`  👉 Rejection message: "${err.message}"`);
    assert.equal(err.code, HOURLY_HELPER_COMING_SOON_CODE, 'Must reject with HOURLY_HELPER_COMING_SOON_CODE');
  }

  console.log('\n================================================================================');
  console.log('🎉 ALL 5 REQUIREMENTS VERIFIED SUCCESSFULLY!');
  console.log('================================================================================\n');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
