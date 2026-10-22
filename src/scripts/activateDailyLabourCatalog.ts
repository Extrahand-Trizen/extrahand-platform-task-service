import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const DAILY_LABOUR_CATEGORY = {
  slug: 'daily-labour',
  name: 'Daily Labour',
  description: 'Book a casual worker for a half-day or full-day service.',
  sortOrder: 40,
  taskCategory: 'other',
  partnerCategory: 'daily-labour',
};

const DAILY_LABOUR_OPTIONS = [
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
];

const DAILY_LABOUR_HUB_SECTION = {
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
};

async function activate(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/extrahand';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection failed');
  }

  console.log('Activating Daily Labour category...');
  await db.collection('servicecategories').updateOne(
    { slug: DAILY_LABOUR_CATEGORY.slug },
    {
      $set: {
        slug: DAILY_LABOUR_CATEGORY.slug,
        name: DAILY_LABOUR_CATEGORY.name,
        description: DAILY_LABOUR_CATEGORY.description,
        sortOrder: DAILY_LABOUR_CATEGORY.sortOrder,
        isActive: true,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  const cat = await db.collection('servicecategories').findOne({ slug: DAILY_LABOUR_CATEGORY.slug });
  const categoryId = cat?._id;

  console.log('Activating Daily Labour category content...');
  await db.collection('booknowcategorycontents').updateOne(
    { categorySlug: DAILY_LABOUR_CATEGORY.slug },
    {
      $set: {
        categorySlug: DAILY_LABOUR_CATEGORY.slug,
        title: DAILY_LABOUR_CATEGORY.name,
        subtitle: 'Daily Labour',
        description: DAILY_LABOUR_CATEGORY.description,
        heroImageUrl:
          'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/hourly-based.webp',
        faqCategoryKeys: [],
        sortOrder: DAILY_LABOUR_CATEGORY.sortOrder,
        isActive: true,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  console.log('Activating Daily Labour hub section...');
  await db.collection('booknowhubsections').updateOne(
    { slug: DAILY_LABOUR_HUB_SECTION.slug },
    {
      $set: {
        slug: DAILY_LABOUR_HUB_SECTION.slug,
        title: DAILY_LABOUR_HUB_SECTION.title,
        iconKey: DAILY_LABOUR_HUB_SECTION.iconKey,
        sortOrder: DAILY_LABOUR_HUB_SECTION.sortOrder,
        isActive: true,
        services: DAILY_LABOUR_HUB_SECTION.services.map((svc) => ({
          serviceId: svc.serviceId,
          label: svc.label,
          categorySlug: svc.categorySlug,
          imageUrl: svc.imageUrl,
          sortOrder: svc.sortOrder,
          isActive: true,
        })),
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  console.log('Activating Daily Labour SKUs & Variants...');
  for (const opt of DAILY_LABOUR_OPTIONS) {
    await db.collection('serviceskus').updateOne(
      { slug: opt.slug },
      {
        $set: {
          categoryId,
          slug: opt.slug,
          name: opt.name,
          description: opt.description,
          basePrice: opt.basePrice,
          offerPrice: 0,
          pricingUnit: 'fixed',
          durationMinutes: opt.durationMinutes,
          taskCategory: 'other',
          isActive: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    const sku = await db.collection('serviceskus').findOne({ slug: opt.slug });
    if (sku) {
      await db.collection('servicevariants').updateOne(
        { skuId: sku._id, slug: 'default' },
        {
          $set: {
            skuId: sku._id,
            slug: 'default',
            name: 'Standard',
            priceDelta: 0,
            durationDeltaMinutes: 0,
            isDefault: true,
            isActive: true,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
    }
  }

  console.log('✅ Daily Labour catalog has been ACTIVATED in MongoDB successfully!');
  await mongoose.disconnect();
}

activate().catch((err) => {
  console.error('Error activating Daily Labour:', err);
  process.exit(1);
});

