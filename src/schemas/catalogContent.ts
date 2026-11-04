import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const optionalImageUrl = z.string().trim().url().or(z.literal('')).optional();
const categoryScopeSchema = z.object({
  includedTitle: z.string().trim().min(1).max(120),
  notIncludedTitle: z.string().trim().min(1).max(120),
  sections: z.array(z.object({
    id: nonEmptyString.max(100),
    label: nonEmptyString.max(120),
    includedItems: z.array(z.string().trim().min(1).max(500)).max(50),
    notIncludedItems: z.array(z.string().trim().min(1).max(500)).max(50),
  })).max(50),
});
const partnerCategoryIdSchema = z.enum([
  'cleaning',
  'electrician',
  'appliance_repair',
  'ac_service',
  'plumbing',
  'carpentry',
  'pest_control',
  'beauty_services',
  'care_services',
  'pet_services',
  'painting',
  'delivery_logistics',
  'driving',
  'professional_services',
  'event_services',
  'car_wash',
  'laundry',
  'daily_labour',
]);

export const createCatalogServiceSchema = z
  .object({
    categorySlug: nonEmptyString.optional(),
    categoryName: nonEmptyString.optional(),
    categoryDescription: z.string().optional(),
    categoryIconUrl: optionalImageUrl,
    categorySortOrder: z.number().int().optional(),
    filterId: nonEmptyString,
    filterLabel: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    imageUrl: optionalImageUrl,
    basePrice: z.number().positive(),
    durationMinutes: z.number().int().min(15),
    pricingUnit: z.enum(['fixed', 'hourly']),
    partnerCategoryId: partnerCategoryIdSchema,
  })
  .refine((value) => Boolean(value.categorySlug) !== Boolean(value.categoryName), {
    message: 'Select an existing category or enter a new category name',
    path: ['categoryName'],
  });

export type CreateCatalogServiceInput = z.infer<typeof createCatalogServiceSchema>;

export const updateCatalogServiceImageSchema = z.object({
  imageUrl: optionalImageUrl,
});

export const updateCatalogServiceOfferSchema = z.object({
  offerPrice: z.number().positive().nullable(),
});

export const updateCatalogServiceStatusSchema = z.object({
  isActive: z.boolean(),
});

export const updateCatalogServiceSchema = z.object({
  categorySlug: nonEmptyString,
  name: nonEmptyString,
  description: z.string().max(500),
  imageUrl: optionalImageUrl,
  basePrice: z.number().positive(),
  offerPrice: z.number().positive().nullable(),
  durationMinutes: z.number().int().min(15),
  pricingUnit: z.enum(['fixed', 'hourly']),
  partnerCategoryId: partnerCategoryIdSchema.or(z.literal('other')),
  isActive: z.boolean(),
});
export type UpdateCatalogServiceInput = z.infer<typeof updateCatalogServiceSchema>;

export const bookNowSkuFaqItemSchema = z.object({
  question: nonEmptyString,
  answer: nonEmptyString,
});

export const upsertSkuContentSchema = z.object({
  categorySlug: nonEmptyString,
  skuSlug: nonEmptyString,
  displayName: nonEmptyString,
  shortDescription: z.string().optional(),
  longDescription: z.string().optional(),
  filterId: nonEmptyString.optional(),
  filterLabel: nonEmptyString.optional(),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
  imageUrls: z.array(z.string()).optional(),
  faqItems: z.array(bookNowSkuFaqItemSchema).optional(),
  sortOrder: z.number().optional(),
  isFeaturedOnHome: z.boolean().optional(),
  featuredSortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const patchSkuContentSchema = z
  .object({
    categorySlug: nonEmptyString.optional(),
    skuSlug: nonEmptyString.optional(),
    displayName: nonEmptyString.optional(),
    shortDescription: z.string().optional(),
    longDescription: z.string().optional(),
    filterId: nonEmptyString.optional(),
    filterLabel: nonEmptyString.optional(),
    includes: z.array(z.string()).optional(),
    excludes: z.array(z.string()).optional(),
    imageUrls: z.array(z.string()).optional(),
    faqItems: z.array(bookNowSkuFaqItemSchema).optional(),
    sortOrder: z.number().optional(),
    isFeaturedOnHome: z.boolean().optional(),
    featuredSortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required for update',
  });

const customerHomePromotionFields = {
  tag: nonEmptyString.max(40),
  title: nonEmptyString.max(100),
  subtitle: nonEmptyString.max(160),
  actionType: z.enum(['route', 'category', 'services_hub', 'url', 'none']),
  actionValue: z.string().trim().optional(),
  sortOrder: z.number().int().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
};

export const createCustomerHomePromotionSchema = z.object(customerHomePromotionFields)
  .refine((value) => value.actionType === 'none' || Boolean(value.actionValue?.trim()), {
    message: 'Action value is required for the selected action type',
    path: ['actionValue'],
  })
  .refine(
    (value) => !value.startsAt || !value.endsAt || new Date(value.endsAt) >= new Date(value.startsAt),
    { message: 'End date must be on or after the start date', path: ['endsAt'] },
  );

export const patchCustomerHomePromotionSchema = z.object({
  ...customerHomePromotionFields,
}).partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required for update',
  });

export const patchOperationalSkuOfferSchema = z
  .object({
    basePrice: z.number().min(0).optional(),
    offerPrice: z.number().min(0).optional(),
    offerDiscountType: z.enum(['percent', 'flat']).optional(),
    offerDiscountValue: z.number().min(0).optional(),
    isOfferActive: z.boolean().optional(),
    durationMinutes: z.number().int().min(15).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one operational field is required for update',
  });

export const helpSupportFaqItemSchema = z.object({
  q: nonEmptyString,
  a: nonEmptyString,
});

export const helpSupportVariantSchema = z.enum(['customer', 'helper']);

export const upsertHelpSupportCategorySchema = z.object({
  variant: helpSupportVariantSchema,
  categoryKey: nonEmptyString,
  title: nonEmptyString,
  subtitle: nonEmptyString,
  icon: nonEmptyString,
  items: z.array(helpSupportFaqItemSchema).optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const patchHelpSupportCategorySchema = z
  .object({
    variant: helpSupportVariantSchema.optional(),
    categoryKey: nonEmptyString.optional(),
    title: nonEmptyString.optional(),
    subtitle: nonEmptyString.optional(),
    icon: nonEmptyString.optional(),
    items: z.array(helpSupportFaqItemSchema).optional(),
    sortOrder: z.number().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required for update',
  });

export const upsertCategoryContentSchema = z.object({
  categorySlug: nonEmptyString,
  title: nonEmptyString,
  subtitle: z.string().optional(),
  description: z.string().optional(),
  heroImageUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  scope: categoryScopeSchema.optional(),
  faqCategoryKeys: z.array(z.string()).optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  minOrderValue: z.number().nonnegative().optional(),
});

export const patchCategoryContentSchema = z
  .object({
    categorySlug: nonEmptyString.optional(),
    title: nonEmptyString.optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    heroImageUrl: z.string().optional(),
    iconUrl: z.string().optional(),
    scope: categoryScopeSchema.optional(),
    faqCategoryKeys: z.array(z.string()).optional(),
    sortOrder: z.number().optional(),
    isActive: z.boolean().optional(),
    minOrderValue: z.number().nonnegative().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required for update',
  });

export const bookNowHubServiceItemSchema = z.object({
  serviceId: nonEmptyString,
  label: nonEmptyString,
  categorySlug: nonEmptyString,
  sectionId: z.string().optional(),
  imageUrl: z.string().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const upsertHubSectionSchema = z.object({
  slug: nonEmptyString,
  title: nonEmptyString,
  iconKey: z.string().optional(),
  sortOrder: z.number().optional(),
  services: z.array(bookNowHubServiceItemSchema).optional(),
  isActive: z.boolean().optional(),
});

export const patchHubSectionSchema = z
  .object({
    slug: nonEmptyString.optional(),
    title: nonEmptyString.optional(),
    iconKey: z.string().optional(),
    sortOrder: z.number().optional(),
    services: z.array(bookNowHubServiceItemSchema).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required for update',
  });

export type UpsertSkuContentInput = z.infer<typeof upsertSkuContentSchema>;
export type PatchSkuContentInput = z.infer<typeof patchSkuContentSchema>;
export type PatchOperationalSkuOfferInput = z.infer<typeof patchOperationalSkuOfferSchema>;
export type UpsertHelpSupportCategoryInput = z.infer<typeof upsertHelpSupportCategorySchema>;
export type PatchHelpSupportCategoryInput = z.infer<typeof patchHelpSupportCategorySchema>;
export type UpsertCategoryContentInput = z.infer<typeof upsertCategoryContentSchema>;
export type PatchCategoryContentInput = z.infer<typeof patchCategoryContentSchema>;
export type UpsertHubSectionInput = z.infer<typeof upsertHubSectionSchema>;
export type PatchHubSectionInput = z.infer<typeof patchHubSectionSchema>;
export type CreateCustomerHomePromotionInput = z.infer<typeof createCustomerHomePromotionSchema>;
export type PatchCustomerHomePromotionInput = z.infer<typeof patchCustomerHomePromotionSchema>;
