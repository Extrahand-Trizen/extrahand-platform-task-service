import assert from 'node:assert/strict';
import {
  createCatalogServiceSchema,
  updateCatalogServiceStatusSchema,
  updateCatalogServiceSchema,
} from '../schemas/catalogContent';

const serviceBase = {
  filterId: 'standard',
  filterLabel: 'Standard',
  name: 'Air Conditioner Service',
  basePrice: 1250,
  durationMinutes: 60,
  pricingUnit: 'fixed' as const,
  partnerCategoryId: 'ac_service' as const,
};

const newCategory = createCatalogServiceSchema.safeParse({
  ...serviceBase,
  categoryName: 'AC Services',
  categoryDescription: 'Installation and repairs',
  imageUrl: 'https://example.com/ac-service.webp',
});
assert.equal(newCategory.success, true);

const existingCategory = createCatalogServiceSchema.safeParse({
  ...serviceBase,
  categorySlug: 'ac-services',
});
assert.equal(existingCategory.success, true);

assert.equal(
  createCatalogServiceSchema.safeParse(serviceBase).success,
  false,
  'A new category name or existing category slug is required',
);
assert.equal(
  createCatalogServiceSchema.safeParse({
    ...serviceBase,
    categorySlug: 'ac-services',
    filterId: '',
    filterLabel: '',
  }).success,
  false,
  'A service must be assigned to a filter',
);
assert.equal(
  createCatalogServiceSchema.safeParse({
    ...serviceBase,
    categorySlug: 'ac-services',
    categoryName: 'AC Services',
  }).success,
  false,
  'A service cannot target both an existing and a new category',
);
assert.equal(
  createCatalogServiceSchema.safeParse({
    ...serviceBase,
    categorySlug: 'ac-services',
    partnerCategoryId: 'unknown',
  }).success,
  false,
  'Partner routing must use a supported service group',
);
assert.equal(
  createCatalogServiceSchema.safeParse({
    ...serviceBase,
    categorySlug: 'ac-services',
    partnerCategoryId: 'other',
  }).success,
  false,
  'New services cannot use the legacy partner routing group',
);

const updateBase = {
  categorySlug: 'ac-services',
  name: 'Air Conditioner Service',
  description: '',
  basePrice: 1250,
  offerPrice: null,
  durationMinutes: 60,
  pricingUnit: 'fixed' as const,
  isActive: false,
};
assert.equal(
  updateCatalogServiceSchema.safeParse({
    ...updateBase,
    partnerCategoryId: 'other',
  }).success,
  true,
  'Existing services with the legacy partner routing group can be deactivated',
);
assert.equal(
  updateCatalogServiceSchema.safeParse({
    ...updateBase,
    partnerCategoryId: 'unknown',
  }).success,
  false,
  'Updates must still reject unsupported partner routing groups',
);
assert.equal(
  updateCatalogServiceStatusSchema.safeParse({ isActive: false }).success,
  true,
  'Service status can be updated independently',
);
assert.equal(
  updateCatalogServiceStatusSchema.safeParse({ isActive: 'false' }).success,
  false,
  'Service status updates require a boolean',
);
assert.equal(
  createCatalogServiceSchema.safeParse({
    ...serviceBase,
    categorySlug: 'ac-services',
    basePrice: 0,
  }).success,
  false,
  'Bookable services must have a positive price',
);

console.log('Catalog service creation schema tests passed');
