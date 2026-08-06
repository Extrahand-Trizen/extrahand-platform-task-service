/**
 * Seed rows for BookNowCategoryContent — Book Now catalog parent categories.
 * Labels aligned with mobile / coupon-portal Book Now category slugs.
 */
export type BookNowCategoryContentSeed = {
  categorySlug: string;
  title: string;
  subtitle: string;
  description: string;
  heroImageUrl?: string;
  sortOrder: number;
};

export const BOOK_NOW_CATEGORY_CONTENT_SEED: BookNowCategoryContentSeed[] = [
  {
    categorySlug: 'full-house',
    title: 'Full House Cleaning',
    subtitle: 'Deep clean for your entire home',
    description: 'Professional full-house cleaning packages for apartments and homes.',
    sortOrder: 10,
  },
  {
    categorySlug: 'bathroom',
    title: 'Bathroom Cleaning',
    subtitle: 'Bathroom deep clean and sanitization',
    description: 'Bathroom cleaning packages for single or multiple bathrooms.',
    sortOrder: 20,
  },
  {
    categorySlug: 'kitchen',
    title: 'Kitchen Cleaning',
    subtitle: 'Kitchen deep clean and grease removal',
    description: 'Kitchen cleaning focused on counters, appliances, and floors.',
    sortOrder: 30,
  },
  {
    categorySlug: 'sofa',
    title: 'Sofa Cleaning',
    subtitle: 'Upholstery cleaning for sofas and couches',
    description: 'Sofa and upholstery cleaning packages by seat count.',
    sortOrder: 40,
  },
  {
    categorySlug: 'mattress',
    title: 'Mattress Cleaning',
    subtitle: 'Mattress deep clean and sanitization',
    description: 'Mattress cleaning packages for single, double, and king sizes.',
    sortOrder: 50,
  },
  {
    categorySlug: 'window-glass',
    title: 'Window & Glass Cleaning',
    subtitle: 'Windows, balconies, and glass surfaces',
    description: 'Window and glass cleaning for homes and apartments.',
    sortOrder: 60,
  },
  {
    categorySlug: 'ac-services',
    title: 'AC Services',
    subtitle: 'AC service, gas refill, and repair',
    description: 'Air conditioner service and repair packages.',
    sortOrder: 70,
  },
  {
    categorySlug: 'appliance-repair',
    title: 'Appliance Repair',
    subtitle: 'Home appliance diagnosis and repair',
    description: 'Repair packages for common home appliances.',
    sortOrder: 80,
  },
  {
    categorySlug: 'womens-beauty',
    title: "Women's Beauty",
    subtitle: 'Facials, waxing, threading, manicure and pedicure',
    description: "Salon-at-home beauty services for women's skincare and grooming.",
    sortOrder: 100,
  },
  {
    categorySlug: 'womens-hair',
    title: "Women's Hair",
    subtitle: 'Haircut, trim, spa and color application',
    description: "Women's hair services delivered at home.",
    sortOrder: 110,
  },
  {
    categorySlug: 'mens-grooming',
    title: "Men's Grooming",
    subtitle: 'Haircut, shave, facial, manicure and pedicure',
    description: "Men's grooming services with transparent offer pricing.",
    sortOrder: 120,
  },
  {
    categorySlug: 'massage',
    title: 'Massage',
    subtitle: 'Head, foot, shoulder and full body massage',
    description: 'At-home massage services for relaxation and recovery.',
    sortOrder: 130,
  },
];
