import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

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
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
  imageUrls: z.array(z.string()).optional(),
  faqItems: z.array(bookNowSkuFaqItemSchema).optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const patchSkuContentSchema = z
  .object({
    categorySlug: nonEmptyString.optional(),
    skuSlug: nonEmptyString.optional(),
    displayName: nonEmptyString.optional(),
    shortDescription: z.string().optional(),
    longDescription: z.string().optional(),
    includes: z.array(z.string()).optional(),
    excludes: z.array(z.string()).optional(),
    imageUrls: z.array(z.string()).optional(),
    faqItems: z.array(bookNowSkuFaqItemSchema).optional(),
    sortOrder: z.number().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required for update',
  });

export const patchOperationalSkuOfferSchema = z
  .object({
    basePrice: z.number().min(0).optional(),
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
  faqCategoryKeys: z.array(z.string()).optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const patchCategoryContentSchema = z
  .object({
    categorySlug: nonEmptyString.optional(),
    title: nonEmptyString.optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    heroImageUrl: z.string().optional(),
    iconUrl: z.string().optional(),
    faqCategoryKeys: z.array(z.string()).optional(),
    sortOrder: z.number().optional(),
    isActive: z.boolean().optional(),
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
