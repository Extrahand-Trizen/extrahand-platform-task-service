import assert from 'node:assert/strict';
import {
  buildJourneyStartedRecord,
  needsJourneyStartedUpdate,
} from '../utils/journeyStarted';

const tappedAt = new Date('2026-11-19T10:23:15.352Z');
const fallbackAt = new Date('2026-11-19T10:24:00.000Z');
const coordinates = { lat: 17.6868, lng: 83.2185 };

assert.equal(
  needsJourneyStartedUpdate({ location: {} }, {
    at: tappedAt,
    location: coordinates,
  }),
  true,
  'an empty Mongoose nested object should be treated as incomplete',
);
assert.deepEqual(
  buildJourneyStartedRecord(
    { location: {} },
    { at: tappedAt, location: coordinates },
    fallbackAt,
  ),
  { at: tappedAt, location: coordinates },
  'the tap time and coordinates should fill an existing empty journey object',
);

const existingAt = new Date('2026-11-19T10:20:00.000Z');
assert.deepEqual(
  buildJourneyStartedRecord(
    { at: existingAt },
    { at: tappedAt, location: coordinates },
    fallbackAt,
  ),
  { at: existingAt, location: coordinates },
  'repairing missing coordinates should preserve the original journey time',
);

assert.equal(
  needsJourneyStartedUpdate({ at: existingAt, location: coordinates }, {
    at: tappedAt,
    location: { lat: 1, lng: 2 },
  }),
  false,
  'a complete journey record should not be overwritten on a later request',
);

console.log('journeyStartedPersistence.test.ts passed');
