const mongoose = require('mongoose');

const uri = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';

async function main() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB successfully.');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));

    // 1. ServiceCategories
    const categoriesCol = db.collection('servicecategories');
    const categories = await categoriesCol.find({}).toArray();
    console.log(`\n=== Found ${categories.length} ServiceCategories ===`);

    // 2. ServiceSkus
    const skusCol = db.collection('serviceskus');
    const skus = await skusCol.find({}).toArray();
    console.log(`\n=== Found ${skus.length} ServiceSkus ===`);

    // 3. BookNowHubSections
    const hubCol = db.collection('booknowhubsections');
    const hubSections = await hubCol.find({}).toArray();
    console.log(`\n=== Found ${hubSections.length} BookNowHubSections ===`);

    // 4. Print structured catalog
    const results = [];

    // Map by category
    const catMap = new Map();
    categories.forEach(c => {
      catMap.set(String(c._id), c);
      catMap.set(c.slug, c);
    });

    console.log('\n--- SAMPLE CATEGORIES ---');
    categories.forEach(c => {
      console.log(`Category: [${c.slug || c._id}] "${c.name}" (minOrderValue: ${c.minOrderValue ?? c.minimumOrderValue ?? 'none'}, active: ${c.isActive})`);
    });

    console.log('\n--- ALL SKUS AND PRICES ---');
    skus.forEach(s => {
      const cat = catMap.get(String(s.categoryId)) || catMap.get(s.categorySlug) || {};
      const price = s.pricing?.offerPrice ?? s.pricing?.basePrice ?? s.basePrice ?? s.price ?? 0;
      const originalPrice = s.pricing?.originalPrice ?? s.pricing?.globalPrice ?? s.originalPrice ?? price;
      const duration = s.durationMinutes ?? s.estimatedDurationMinutes ?? 'N/A';
      console.log(`SKU: [${s.categorySlug || cat.slug || 'uncategorized'}] "${s.name}" | Offer: ₹${price} | MRP: ₹${originalPrice} | Duration: ${duration} mins | Unit: ${s.pricingUnit || s.unit || 'visit'} | MinPrice: ${s.minPrice || s.minimumPrice || 'N/A'}`);
      results.push({
        id: s._id,
        category: cat.name || s.categorySlug || 'Uncategorized',
        categorySlug: s.categorySlug || cat.slug,
        name: s.name,
        slug: s.slug || s.skuSlug,
        offerPrice: price,
        originalPrice: originalPrice,
        durationMinutes: duration,
        pricingUnit: s.pricingUnit || s.unit || 'per visit',
        isActive: s.isActive
      });
    });

    // Write full json dump to disk for deep inspection
    const fs = require('fs');
    fs.writeFileSync('all_services_dump.json', JSON.stringify({ categories, skusCount: skus.length, results }, null, 2));
    console.log('\nWrote full dump to extrahand-platform-task-service/all_services_dump.json');

    process.exit(0);
  } catch (err) {
    console.error('Error connecting or querying MongoDB:', err);
    process.exit(1);
  }
}

main();

