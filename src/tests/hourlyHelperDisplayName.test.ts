import assert from 'assert';
import { getHourlyHelperSkuDisplayName } from '../constants/hourlyBooking';

assert.strictEqual(getHourlyHelperSkuDisplayName(120), 'ExtraHand Assist · 2 hours');
assert.strictEqual(getHourlyHelperSkuDisplayName(90), 'ExtraHand Assist · 1.5 hours');
assert.strictEqual(getHourlyHelperSkuDisplayName(30), 'ExtraHand Assist · 30 minutes');
assert.strictEqual(getHourlyHelperSkuDisplayName(75), 'ExtraHand Assist · 1 hr 15 min');

console.log('hourlyHelperDisplayName.test.ts: all passed');
