import assert from 'node:assert/strict';
import { buildOrderedWorkAreasForDispatch } from '../services/BookNowAutoAssignService';

const siddipetTask = {
  location: {
    taskArea: 'Shivaji Nagar',
    city: 'Siddipet',
    coordinates: [78.8525, 18.1018],
  },
} as any;

const siddipetAreas = buildOrderedWorkAreasForDispatch(siddipetTask);
assert.deepStrictEqual(
  siddipetAreas.map(({ area }) => area),
  ['Shivaji Nagar', 'Siddipet'],
  'Siddipet work should not expand into distant Hyderabad work areas',
);
assert.ok(
  !siddipetAreas.some(({ area }) => area === 'Secunderabad'),
  'Secunderabad partners must not be included for Siddipet work',
);

const hyderabadTask = {
  location: {
    taskArea: 'Gachibowli',
    city: 'Hyderabad',
    coordinates: [78.3489, 17.4401],
  },
} as any;
const hyderabadAreas = buildOrderedWorkAreasForDispatch(hyderabadTask);
assert.ok(hyderabadAreas.some(({ area }) => area === 'Gachibowli'));
assert.ok(
  hyderabadAreas.some(({ area }) => area === 'Madhapur'),
  'Nearby Hyderabad work areas should remain eligible',
);

console.log('bookNowDispatchWorkAreas.test.ts: all tests passed');
