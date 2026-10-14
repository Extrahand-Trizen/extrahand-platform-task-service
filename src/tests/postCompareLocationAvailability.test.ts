import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import LocationArea from '../models/LocationArea';
import PostCompareLocationAvailability from '../models/PostCompareLocationAvailability';
import {
  isHourlyHelperTask,
  PostCompareLocationAvailabilityService,
} from '../services/PostCompareLocationAvailabilityService';

const areaId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const canonicalArea = {
  _id: areaId,
  canonicalName: 'Madhapur',
  displayName: 'Madhapur',
};

function mockMethod(target: object, name: string, implementation: (...args: never[]) => unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value: implementation,
  });
  return () => {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  };
}

async function withAvailabilityMocks(
  options: {
    area?: typeof canonicalArea | null;
    availability?: { isEnabled: boolean; updatedAt?: Date; updatedBy?: string } | null;
    areaError?: Error;
    availabilityError?: Error;
  },
  run: () => Promise<void>,
): Promise<void> {
  const restoreAreaFindOne = mockMethod(
    LocationArea,
    'findOne',
    (() => ({
      lean: async () => {
        if (options.areaError) throw options.areaError;
        return options.area === undefined ? canonicalArea : options.area;
      },
    })) as (...args: never[]) => unknown,
  );
  const restoreAvailabilityFindOne = mockMethod(
    PostCompareLocationAvailability,
    'findOne',
    (() => ({
      lean: async () => {
        if (options.availabilityError) throw options.availabilityError;
        return options.availability ?? null;
      },
    })) as (...args: never[]) => unknown,
  );

  try {
    await run();
  } finally {
    restoreAvailabilityFindOne();
    restoreAreaFindOne();
  }
}

async function expectUnavailable(taskData: Record<string, unknown>): Promise<void> {
  await assert.rejects(
    PostCompareLocationAvailabilityService.assertTaskAreaEnabled(taskData),
    (error: Error & { code?: string }) => error.code === 'POST_COMPARE_AREA_UNAVAILABLE',
  );
}

async function runTests(): Promise<void> {
  const task = (categorySlug: string) => ({
    category: categorySlug,
    categorySlug,
    location: { taskArea: 'Madhapur', city: 'Hyderabad' },
  });

  await withAvailabilityMocks({ availability: null }, async () => {
    await expectUnavailable(task('cleaning'));
  });

  assert.equal(
    isHourlyHelperTask({ categorySlug: 'home-cleaning', budgetType: 'hourly' }),
    false,
    'hourly budget type on a Post & Compare category must not bypass area availability',
  );
  await withAvailabilityMocks({ availability: null }, async () => {
    await expectUnavailable({
      ...task('home-cleaning'),
      budgetType: 'hourly',
    });
  });

  await withAvailabilityMocks({ availability: { isEnabled: true } }, async () => {
    await PostCompareLocationAvailabilityService.assertTaskAreaEnabled(task('cleaning'));
  });

  await withAvailabilityMocks({ availability: { isEnabled: false } }, async () => {
    await expectUnavailable(task('cleaning'));
  });

  await withAvailabilityMocks({ area: null }, async () => {
    await expectUnavailable({
      categorySlug: 'cleaning',
      location: { address: 'Unmapped residential address', city: 'Hyderabad' },
    });
  });

  await withAvailabilityMocks({ availability: { isEnabled: true } }, async () => {
    for (const category of ['cleaning', 'delivery', 'packers-movers', 'repair']) {
      await PostCompareLocationAvailabilityService.assertTaskAreaEnabled(task(category));
    }
  });

  await withAvailabilityMocks({ areaError: new Error('location database unavailable') }, async () => {
    await assert.rejects(
      PostCompareLocationAvailabilityService.assertTaskAreaEnabled(task('cleaning')),
      /location database unavailable/,
    );
  });

  await withAvailabilityMocks({ availabilityError: new Error('policy database unavailable') }, async () => {
    await assert.rejects(
      PostCompareLocationAvailabilityService.assertTaskAreaEnabled(task('cleaning')),
      /policy database unavailable/,
    );
  });

  let hourlyLookups = 0;
  const restoreHourlyAreaLookup = mockMethod(
    LocationArea,
    'findOne',
    (() => {
      hourlyLookups += 1;
      return { lean: async () => canonicalArea };
    }) as (...args: never[]) => unknown,
  );
  const restoreHourlyPolicyLookup = mockMethod(
    PostCompareLocationAvailability,
    'findOne',
    (() => {
      hourlyLookups += 1;
      return { lean: async () => null };
    }) as (...args: never[]) => unknown,
  );
  try {
    await PostCompareLocationAvailabilityService.assertTaskAreaEnabled({
      categorySlug: 'hourly-based',
      budgetType: 'hourly',
      location: { taskArea: 'Madhapur' },
    });
    assert.equal(hourlyLookups, 0, 'Hourly Helper task creation must not query Post & Compare policy');
  } finally {
    restoreHourlyPolicyLookup();
    restoreHourlyAreaLookup();
  }

  const restoreToggleAreaLookup = mockMethod(
    LocationArea,
    'findOne',
    (() => ({ lean: async () => canonicalArea })) as (...args: never[]) => unknown,
  );
  let writes = 0;
  const expectedRecord = {
    isEnabled: true,
    updatedBy: 'ops@example.com',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const restoreToggleUpsert = mockMethod(
    PostCompareLocationAvailability,
    'findOneAndUpdate',
    (() => {
      writes += 1;
      if (writes === 1) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      return { lean: async () => expectedRecord };
    }) as (...args: never[]) => unknown,
  );
  try {
    const result = await PostCompareLocationAvailabilityService.setAreaAvailability({
      areaId: String(areaId),
      isEnabled: true,
      updatedBy: 'ops@example.com',
    });
    assert.equal(writes, 2, 'duplicate-key race retries by updating the existing record');
    assert.equal(result.isEnabled, true);
    assert.equal(result.updatedBy, 'ops@example.com');
  } finally {
    restoreToggleUpsert();
    restoreToggleAreaLookup();
  }

  console.log('postCompareLocationAvailability.test.ts passed');
}

runTests().catch((error) => {
  console.error('Post & Compare availability tests failed:', error);
  process.exit(1);
});
