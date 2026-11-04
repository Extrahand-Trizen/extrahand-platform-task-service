import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BookNowAvailabilityService } from '../services/BookNowAvailabilityService';
import { LocationPricingService } from '../services/LocationPricingService';
import BookNowLocationAvailability from '../models/BookNowLocationAvailability';
import LocationArea from '../models/LocationArea';
import LocationCity from '../models/LocationCity';
import LocationState from '../models/LocationState';
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
  const originalAvailabilityFindOneDescriptor = Object.getOwnPropertyDescriptor(
    BookNowLocationAvailability,
    'findOne',
  );
  const originalStateExistsDescriptor = Object.getOwnPropertyDescriptor(LocationState, 'exists');
  const originalCityFindOneDescriptor = Object.getOwnPropertyDescriptor(LocationCity, 'findOne');
  const originalAreaFindOneDescriptor = Object.getOwnPropertyDescriptor(LocationArea, 'findOne');
  const originalDeleteManyDescriptor = Object.getOwnPropertyDescriptor(
    BookNowServiceLocationAvailability,
    'deleteMany',
  );
  const locationId = new mongoose.Types.ObjectId();
  let savedAvailabilityUpdate: Record<string, any> | undefined;
  let removedServiceRules: Record<string, any> | undefined;
  const stateId = new mongoose.Types.ObjectId();
  const existingCity = {
    _id: locationId,
    canonicalName: 'Mahbubnagar',
    displayName: 'Mahbubnagar',
    normalizedKey: 'mahbubnagar',
    aliases: ['Mahbubnagar', 'Mahbub Nagar'],
    isActive: true,
    async save() {
      return this;
    },
  };
  const existingArea = {
    _id: locationId,
    canonicalName: 'Siddipet',
    displayName: 'Siddipet',
    normalizedKey: 'siddipet',
    aliases: ['Siddipet'],
    isActive: true,
    async save() {
      return this;
    },
  };

  try {
    Object.defineProperty(LocationPricingService, 'listLocations', {
      configurable: true,
      value: async () => [{ _id: locationId, isActive: true }],
    });
    Object.defineProperty(BookNowLocationAvailability, 'findOneAndUpdate', {
      configurable: true,
      value: (_query: unknown, update: Record<string, any>) => {
        savedAvailabilityUpdate = update;
        const result = { isEnabled: false, isHidden: true };
        return Object.assign(Promise.resolve(result), {
          lean: async () => result,
        });
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

    await BookNowAvailabilityService.setLocationAvailability({
      locationType: 'area',
      locationId: String(locationId),
      isEnabled: false,
      updatedBy: 'admin',
    });
    assert.deepEqual(savedAvailabilityUpdate?.$set, {
      isEnabled: false,
      isHidden: false,
      updatedBy: 'admin',
    });

    Object.defineProperty(LocationState, 'exists', {
      configurable: true,
      value: async () => ({ _id: stateId }),
    });
    Object.defineProperty(LocationCity, 'findOne', {
      configurable: true,
      value: () => existingCity,
    });
    Object.defineProperty(BookNowLocationAvailability, 'findOne', {
      configurable: true,
      value: () => ({ lean: async () => ({ isHidden: true }) }),
    });

    const restoredCity = await LocationPricingService.createLocation('city', {
      stateId: String(stateId),
      canonicalName: 'Mahabubnagar',
      displayName: 'Mahabubnagar',
      aliases: ['Mahabubnagar', 'Mahabub Nagar', 'Mahbubnagar'],
    });
    assert.equal(restoredCity, existingCity);
    assert.equal(existingCity.isActive, true);
    assert.equal(existingCity.normalizedKey, 'mahabubnagar');
    assert.ok(existingCity.aliases.includes('Mahbubnagar'));

    Object.defineProperty(LocationArea, 'findOne', {
      configurable: true,
      value: async () => existingArea,
    });
    const restoredArea = await LocationPricingService.createLocation('area', {
      canonicalName: 'Siddipet',
      displayName: 'Siddipet',
      aliases: ['Siddipet', 'Siddipet, Telangana'],
    });
    assert.equal(restoredArea, existingArea);
    assert.equal(existingArea.isActive, true);
    assert.ok(existingArea.aliases.includes('Siddipet, Telangana'));
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
    if (originalAvailabilityFindOneDescriptor) {
      Object.defineProperty(
        BookNowLocationAvailability,
        'findOne',
        originalAvailabilityFindOneDescriptor,
      );
    } else {
      Reflect.deleteProperty(BookNowLocationAvailability, 'findOne');
    }
    if (originalStateExistsDescriptor) {
      Object.defineProperty(LocationState, 'exists', originalStateExistsDescriptor);
    } else {
      Reflect.deleteProperty(LocationState, 'exists');
    }
    if (originalCityFindOneDescriptor) {
      Object.defineProperty(LocationCity, 'findOne', originalCityFindOneDescriptor);
    } else {
      Reflect.deleteProperty(LocationCity, 'findOne');
    }
    if (originalAreaFindOneDescriptor) {
      Object.defineProperty(LocationArea, 'findOne', originalAreaFindOneDescriptor);
    } else {
      Reflect.deleteProperty(LocationArea, 'findOne');
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
