import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BookNowAvailabilityService } from '../services/BookNowAvailabilityService';
import { LocationPricingService } from '../services/LocationPricingService';
import BookNowLocationAvailability from '../models/BookNowLocationAvailability';
import BookNowServiceLocationAvailability from '../models/BookNowServiceLocationAvailability';

async function runTests() {
  const originalResolveAddress = LocationPricingService.resolveAddress;
  const originalFindDescriptor = Object.getOwnPropertyDescriptor(BookNowLocationAvailability, 'find');
  const originalServiceFindDescriptor = Object.getOwnPropertyDescriptor(
    BookNowServiceLocationAvailability,
    'find',
  );
  const resolvedAddress: Awaited<ReturnType<typeof LocationPricingService.resolveAddress>> = {
    stateId: null,
    cityId: null,
    pincodeId: null,
    areaId: null,
    coordinates: null,
    displayAddress: null,
    confidence: 'low',
    source: 'unresolved',
    resolverVersion: '1',
    resolvedAt: new Date().toISOString(),
  };
  LocationPricingService.resolveAddress = async () => resolvedAddress;

  try {
    const unmatchedAvailability = await BookNowAvailabilityService.getAvailabilityForAddress({});
    assert.equal(unmatchedAvailability.isEnabled, false);
    assert.equal(unmatchedAvailability.isExplicit, false);
    assert.match(unmatchedAvailability.message || '', /not available at this location/i);

    Object.defineProperty(BookNowLocationAvailability, 'find', {
      configurable: true,
      value: () => ({ lean: async () => [] }),
    });
    resolvedAddress.cityId = new mongoose.Types.ObjectId();
    const unconfiguredAvailability = await BookNowAvailabilityService.getAvailabilityForAddress({});
    assert.equal(unconfiguredAvailability.isEnabled, false);
    assert.equal(unconfiguredAvailability.isExplicit, false);
    assert.match(unconfiguredAvailability.message || '', /not available at this location/i);

    Object.defineProperty(BookNowLocationAvailability, 'find', {
      configurable: true,
      value: () => ({
        lean: async () => [{
          locationType: 'city',
          locationId: resolvedAddress.cityId,
          isEnabled: true,
        }],
      }),
    });
    Object.defineProperty(BookNowServiceLocationAvailability, 'find', {
      configurable: true,
      value: () => ({
        lean: async () => [{
          locationType: 'city',
          locationId: resolvedAddress.cityId,
          isEnabled: false,
        }],
      }),
    });
    const categoryAvailability =
      await BookNowAvailabilityService.getAvailabilityForAddress({}, 'bathroom');
    assert.equal(categoryAvailability.isEnabled, false);
    assert.equal(categoryAvailability.catalogId, 'bathroom');
    assert.match(categoryAvailability.message || '', /this service is not available/i);

    Object.defineProperty(BookNowLocationAvailability, 'find', {
      configurable: true,
      value: () => ({
        lean: async () => [{
          locationType: 'city',
          locationId: resolvedAddress.cityId,
          isEnabled: false,
        }],
      }),
    });
    const masterAvailability =
      await BookNowAvailabilityService.getAvailabilityForAddress({}, 'bathroom');
    assert.equal(masterAvailability.isEnabled, false);
    assert.match(masterAvailability.message || '', /book now services are not available/i);
  } finally {
    LocationPricingService.resolveAddress = originalResolveAddress;
    if (originalFindDescriptor) {
      Object.defineProperty(BookNowLocationAvailability, 'find', originalFindDescriptor);
    }
    if (originalServiceFindDescriptor) {
      Object.defineProperty(
        BookNowServiceLocationAvailability,
        'find',
        originalServiceFindDescriptor,
      );
    }
  }

  const originalListLocationsDescriptor = Object.getOwnPropertyDescriptor(
    LocationPricingService,
    'listLocations',
  );
  const originalFindOneAndUpdateDescriptor = Object.getOwnPropertyDescriptor(
    BookNowLocationAvailability,
    'findOneAndUpdate',
  );
  const originalDeleteManyDescriptor = Object.getOwnPropertyDescriptor(
    BookNowServiceLocationAvailability,
    'deleteMany',
  );
  const locationId = new mongoose.Types.ObjectId();
  let savedAvailabilityUpdate: Record<string, any> | undefined;
  let removedServiceRules: Record<string, any> | undefined;

  try {
    Object.defineProperty(LocationPricingService, 'listLocations', {
      configurable: true,
      value: async () => [{ _id: locationId, isActive: true }],
    });
    Object.defineProperty(BookNowLocationAvailability, 'findOneAndUpdate', {
      configurable: true,
      value: async (_query: unknown, update: Record<string, any>) => {
        savedAvailabilityUpdate = update;
        return { isEnabled: false, isHidden: true };
      },
    });
    Object.defineProperty(BookNowServiceLocationAvailability, 'deleteMany', {
      configurable: true,
      value: async (query: Record<string, any>) => {
        removedServiceRules = query;
        return { deletedCount: 1 };
      },
    });

    const removed = await BookNowAvailabilityService.removeLocationFromBookNow({
      locationType: 'area',
      locationId: String(locationId),
      updatedBy: 'admin',
    });
    assert.equal(removed.isEnabled, false);
    assert.equal(removed.isHidden, true);
    assert.deepEqual(savedAvailabilityUpdate?.$set, {
      isEnabled: false,
      isHidden: true,
      updatedBy: 'admin',
    });
    assert.deepEqual(removedServiceRules, {
      locationType: 'area',
      locationId,
    });
  } finally {
    if (originalListLocationsDescriptor) {
      Object.defineProperty(
        LocationPricingService,
        'listLocations',
        originalListLocationsDescriptor,
      );
    } else {
      Reflect.deleteProperty(LocationPricingService, 'listLocations');
    }
    if (originalFindOneAndUpdateDescriptor) {
      Object.defineProperty(
        BookNowLocationAvailability,
        'findOneAndUpdate',
        originalFindOneAndUpdateDescriptor,
      );
    } else {
      Reflect.deleteProperty(BookNowLocationAvailability, 'findOneAndUpdate');
    }
    if (originalDeleteManyDescriptor) {
      Object.defineProperty(
        BookNowServiceLocationAvailability,
        'deleteMany',
        originalDeleteManyDescriptor,
      );
    } else {
      Reflect.deleteProperty(BookNowServiceLocationAvailability, 'deleteMany');
    }
  }

  console.log('bookNowAvailability.test.ts passed');
}

runTests().catch((error) => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
