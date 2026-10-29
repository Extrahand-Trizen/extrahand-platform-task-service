import assert from 'assert';
import { LocationPricingService } from '../services/LocationPricingService';
import ServiceCategory from '../models/ServiceCategory';
import BookNowHubSection from '../models/BookNowHubSection';

async function testGroupUpdateLogic() {
  console.log('Testing category group update logic...');

  const originalFindOne = BookNowHubSection.findOne;
  const originalUpdateOne = BookNowHubSection.updateOne;
  const originalUpdateMany = ServiceCategory.updateMany;

  let updateManyFilter: any = null;
  let updateManySet: any = null;
  let hubUpdateFilter: any = null;
  let hubUpdateSet: any = null;

  (BookNowHubSection as any).findOne = () => ({
    lean: async () => ({
      _id: 'hub-home-cleaning',
      slug: 'home-cleaning',
      title: 'Home Cleaning',
      services: [
        { categorySlug: 'full-house' },
        { categorySlug: 'bathroom' },
        { categorySlug: 'kitchen' },
        { categorySlug: 'sofa' },
        { categorySlug: 'mattress' },
        { categorySlug: 'window-glass' },
      ],
    }),
  });

  (BookNowHubSection as any).updateOne = async (filter: any, update: any) => {
    hubUpdateFilter = filter;
    hubUpdateSet = update;
    return { modifiedCount: 1 };
  };

  (ServiceCategory as any).updateMany = async (filter: any, update: any) => {
    updateManyFilter = filter;
    updateManySet = update;
    return { modifiedCount: 7 };
  };

  try {
    const result: any = await LocationPricingService.updateCategoryMinOrderValue('home-cleaning', 499);
    assert.strictEqual(result.id, 'home-cleaning');
    assert.strictEqual(result.minOrderValue, 499);
    assert.strictEqual(result.updatedCount, 7);

    // Filter must contain all cleaning subcategories + parent category
    const queriedSlugs = updateManyFilter?.$or?.[0]?.slug?.$in || updateManyFilter?.slug?.$in;
    assert.ok(Array.isArray(queriedSlugs), 'Queried slugs must be an array');
    assert.ok(queriedSlugs.includes('home-cleaning'), 'Must include home-cleaning');
    assert.ok(queriedSlugs.includes('full-house'), 'Must include full-house');
    assert.ok(queriedSlugs.includes('kitchen'), 'Must include kitchen');
    assert.ok(queriedSlugs.includes('bathroom'), 'Must include bathroom');

    assert.deepStrictEqual(hubUpdateFilter, { _id: 'hub-home-cleaning' });
    assert.deepStrictEqual(updateManySet, { $set: { minOrderValue: 499 } });
    assert.deepStrictEqual(hubUpdateSet, { $set: { minOrderValue: 499 } });
    console.log('✅ updateCategoryMinOrderValue successfully updates all services under parent category!');
  } finally {
    (BookNowHubSection as any).findOne = originalFindOne;
    (BookNowHubSection as any).updateOne = originalUpdateOne;
    (ServiceCategory as any).updateMany = originalUpdateMany;
  }
}

testGroupUpdateLogic()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
