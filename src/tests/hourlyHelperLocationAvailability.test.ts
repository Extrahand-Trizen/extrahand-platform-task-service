import assert from 'node:assert/strict';
import { HourlyHelperLocationAvailabilityService } from '../services/HourlyHelperLocationAvailabilityService';

async function runTests() {
  console.log('Running Hourly Helper Location Availability logic unit tests...');

  // 1. Unconfigured location default
  const defaultStatus = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({});
  assert.equal(defaultStatus, true, 'Unconfigured locations must default to enabled: true');

  console.log('✅ hourlyHelperLocationAvailability.test.ts passed');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
