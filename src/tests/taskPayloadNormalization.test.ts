import assert from 'node:assert/strict';
import { normalizeCreateTaskPayload } from '../services/TaskService';

const sanitized = normalizeCreateTaskPayload({
  category: 'AC Repair & Service',
  categorySlug: 'ac-repair',
  dateOption: 'onDate',
  timeSlot: 'Morning',
  flexibility: 'exact',
  budget: { amount: 500, currency: 'INR', type: 'fixed' },
  recurring: { enabled: true, frequency: 'weeklY' },
});

assert.equal(sanitized.dateOption, 'on-date');
assert.equal(sanitized.timeSlot, 'morning');
assert.equal(sanitized.flexibility, 'strict');
assert.equal(sanitized.recurring.frequency, 'weekly');
assert.equal(sanitized.category, 'repair');
console.log('task payload normalization ok');
