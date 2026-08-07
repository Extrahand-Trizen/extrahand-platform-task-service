export type BeautyOfferCategorySeed = {
  slug: string;
  name: string;
  sortOrder: number;
  description: string;
};

export type BeautyOfferServiceSeed = {
  categorySlug: string;
  skuSlug: string;
  name: string;
  offerPrice: number;
  originalPrice: number;
  durationLabel: string;
  durationMinutes: number;
};

export const BEAUTY_OFFER_CATEGORIES: BeautyOfferCategorySeed[] = [
  {
    slug: 'womens-beauty',
    name: "Women's Beauty",
    sortOrder: 100,
    description: "Women's beauty and skincare services",
  },
  {
    slug: 'womens-hair',
    name: "Women's Hair",
    sortOrder: 110,
    description: "Women's haircut and hair treatment services",
  },
  {
    slug: 'mens-grooming',
    name: "Men's Grooming",
    sortOrder: 120,
    description: "Men's haircut, shave, facial and grooming services",
  },
  {
    slug: 'massage',
    name: 'Massage',
    sortOrder: 130,
    description: 'Massage and relaxation services',
  },
];

export const BEAUTY_OFFER_SERVICES: BeautyOfferServiceSeed[] = [
  { categorySlug: 'womens-beauty', skuSlug: 'dtan-face-neck', name: 'D-Tan – Face & Neck', offerPrice: 499, originalPrice: 699, durationLabel: '40 mins', durationMinutes: 40 },
  { categorySlug: 'womens-beauty', skuSlug: 'gold-facial', name: 'Gold Facial', offerPrice: 699, originalPrice: 899, durationLabel: '1 hr', durationMinutes: 60 },
  { categorySlug: 'womens-beauty', skuSlug: 'o3-shine-glow-facial', name: 'O3 Shine & Glow Facial', offerPrice: 799, originalPrice: 999, durationLabel: '60 mins', durationMinutes: 60 },
  { categorySlug: 'womens-beauty', skuSlug: 'full-face-threading', name: 'Full Face Threading', offerPrice: 199, originalPrice: 299, durationLabel: '30 mins', durationMinutes: 30 },
  { categorySlug: 'womens-beauty', skuSlug: 'half-leg-waxing', name: 'Half Leg Waxing', offerPrice: 399, originalPrice: 549, durationLabel: '45 mins', durationMinutes: 45 },
  { categorySlug: 'womens-beauty', skuSlug: 'full-arms-waxing', name: 'Full Arms Waxing', offerPrice: 399, originalPrice: 549, durationLabel: '45 mins', durationMinutes: 45 },
  { categorySlug: 'womens-beauty', skuSlug: 'basic-manicure', name: 'Basic Manicure', offerPrice: 399, originalPrice: 549, durationLabel: '45 mins', durationMinutes: 45 },
  { categorySlug: 'womens-beauty', skuSlug: 'basic-pedicure', name: 'Basic Pedicure', offerPrice: 499, originalPrice: 699, durationLabel: '50 mins', durationMinutes: 50 },

  { categorySlug: 'womens-hair', skuSlug: 'haircut', name: 'Haircut', offerPrice: 399, originalPrice: 549, durationLabel: '45 mins', durationMinutes: 45 },
  { categorySlug: 'womens-hair', skuSlug: 'hair-trim', name: 'Hair Trim', offerPrice: 299, originalPrice: 399, durationLabel: '30 mins', durationMinutes: 30 },
  { categorySlug: 'womens-hair', skuSlug: 'basic-hair-spa', name: 'Basic Hair Spa', offerPrice: 699, originalPrice: 899, durationLabel: '1 hr', durationMinutes: 60 },
  { categorySlug: 'womens-hair', skuSlug: 'hair-color-application', name: 'Hair Color Application', offerPrice: 399, originalPrice: 549, durationLabel: '1 hr', durationMinutes: 60 },

  { categorySlug: 'mens-grooming', skuSlug: 'haircut', name: 'Haircut', offerPrice: 199, originalPrice: 299, durationLabel: '40 mins', durationMinutes: 40 },
  { categorySlug: 'mens-grooming', skuSlug: 'beard-trim-styling', name: 'Beard Trim & Styling', offerPrice: 149, originalPrice: 249, durationLabel: '30 mins', durationMinutes: 30 },
  { categorySlug: 'mens-grooming', skuSlug: 'clean-shave', name: 'Clean Shave', offerPrice: 149, originalPrice: 199, durationLabel: '30 mins', durationMinutes: 30 },
  { categorySlug: 'mens-grooming', skuSlug: 'mens-facial', name: "Men's Facial", offerPrice: 499, originalPrice: 699, durationLabel: '1 hr', durationMinutes: 60 },
  { categorySlug: 'mens-grooming', skuSlug: 'mens-dtan-face-neck', name: "Men's D-Tan – Face & Neck", offerPrice: 399, originalPrice: 549, durationLabel: '40 mins', durationMinutes: 40 },
  { categorySlug: 'mens-grooming', skuSlug: 'mens-manicure', name: "Men's Manicure", offerPrice: 299, originalPrice: 399, durationLabel: '40 mins', durationMinutes: 40 },
  { categorySlug: 'mens-grooming', skuSlug: 'mens-pedicure', name: "Men's Pedicure", offerPrice: 399, originalPrice: 549, durationLabel: '45 mins', durationMinutes: 45 },

  { categorySlug: 'massage', skuSlug: 'head-massage', name: 'Head Massage', offerPrice: 199, originalPrice: 299, durationLabel: '30 mins', durationMinutes: 30 },
  { categorySlug: 'massage', skuSlug: 'foot-massage', name: 'Foot Massage', offerPrice: 249, originalPrice: 349, durationLabel: '30 mins', durationMinutes: 30 },
  { categorySlug: 'massage', skuSlug: 'neck-shoulder-massage', name: 'Neck & Shoulder Massage', offerPrice: 299, originalPrice: 399, durationLabel: '30 mins', durationMinutes: 30 },
  { categorySlug: 'massage', skuSlug: 'full-body-massage', name: 'Full Body Massage', offerPrice: 799, originalPrice: 999, durationLabel: '1 hr', durationMinutes: 60 },
];
