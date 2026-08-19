import assert from 'node:assert/strict';
import {
  buildPartnerCategoryFilter,
  buildPartnerWorkAreaFilter,
} from '../services/partnerVisibility';
import { applyTaskAreaToLocation } from '../utils/resolveTaskArea';

function testPaintingPartnerCategoryFilter() {
  const filter = buildPartnerCategoryFilter(['painting']);
  assert.ok(filter?.$or);

  const serialized = JSON.stringify(filter);
  assert.ok(serialized.includes('serviceType'));
  assert.ok(serialized.includes('consultation_project'));
  assert.ok(serialized.includes('"other"'));
}

function testPaintingPartnerCategoryObjectInput() {
  const filter = buildPartnerCategoryFilter([{ id: 'painting', label: 'Painting' }]);
  assert.ok(filter?.$or);
  assert.ok(JSON.stringify(filter).includes('painting'));
}

function testWorkAreaGeoProximityFilter() {
  const filter = buildPartnerWorkAreaFilter(['Yapral']);
  assert.ok(filter?.$or);
  const serialized = JSON.stringify(filter);
  assert.ok(serialized.includes('$geoWithin'));
  assert.ok(serialized.includes('$centerSphere'));
}

function testApplyTaskAreaFromCoordinates() {
  const location = applyTaskAreaToLocation({
    type: 'Point',
    coordinates: [78.5369, 17.5147],
    address: '12 Example Street',
    city: 'Hyderabad',
  });

  assert.equal((location as { taskArea?: string })?.taskArea, 'Yapral');
}

function run() {
  testPaintingPartnerCategoryFilter();
  testPaintingPartnerCategoryObjectInput();
  testWorkAreaGeoProximityFilter();
  testApplyTaskAreaFromCoordinates();
  console.log('partnerVisibility painting pool tests passed');
}

run();
