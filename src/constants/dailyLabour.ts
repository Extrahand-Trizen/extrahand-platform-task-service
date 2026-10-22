export const DAILY_LABOUR_ACTIVE = true;

export const DAILY_LABOUR_CATEGORY = {
  slug: 'daily-labour',
  name: 'Daily Labour',
  description: 'Book a casual worker for a half-day or full-day service.',
  sortOrder: 40,
  taskCategory: 'other',
  partnerCategory: 'daily-labour',
} as const;

export const DAILY_LABOUR_OPTIONS = [
  {
    slug: 'daily-labour-half-day',
    name: 'Daily Labour · Half Day',
    description: 'A casual worker for 4 working hours.',
    basePrice: 500,
    durationMinutes: 240,
  },
  {
    slug: 'daily-labour-full-day',
    name: 'Daily Labour · Full Day',
    description: 'A casual worker for 8 working hours.',
    basePrice: 1000,
    durationMinutes: 480,
  },
] as const;

export const DAILY_LABOUR_HUB_SECTION = {
  slug: 'daily-labour',
  title: 'Daily Labour',
  iconKey: 'Users',
  sortOrder: 40,
  services: [
    {
      serviceId: 'daily-labour',
      label: 'Daily Labour',
      categorySlug: 'daily-labour',
      imageUrl:
        'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/hourly-based.webp',
      sortOrder: 0,
      isActive: true,
    },
  ],
} as const;
