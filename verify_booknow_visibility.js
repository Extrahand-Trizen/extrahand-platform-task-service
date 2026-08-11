const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

function normalizeLocationName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALL_BOOK_NOW_TASK_CATEGORIES = ['cleaning', 'repair', 'delivery', 'assembly', 'gardening', 'petcare', 'packers-movers', 'other'];

const CATEGORY_MAP = {
  cleaning: ['cleaning', 'home-cleaning', 'home_cleaning'],
  repair: ['repair', 'plumbing', 'electrical', 'carpenter'],
  plumbing: ['plumbing', 'repair'],
  electrical: ['electrical', 'repair'],
  delivery: ['delivery', 'pickup', 'pick-drop'],
  assembly: ['assembly', 'furniture-assembly'],
  gardening: ['gardening', 'lawn-mowing'],
  petcare: ['petcare', 'pet-care'],
  'packers-movers': ['packers-movers', 'moving'],
  beautician: ['beautician', 'beauty', 'salon'],
  driver: ['driver', 'chauffeur', 'driving'],
  'home-cleaning': ['cleaning', 'home-cleaning'],
};

function normalizeCategory(input) {
  const lower = input.toLowerCase().replace(/[\s_-]+/g, '-');
  for (const [canonical, aliases] of Object.entries(CATEGORY_MAP)) {
    if (aliases.includes(lower) || canonical === lower) return canonical;
  }
  return lower;
}

const PARTNER_CATEGORY_TO_TASK_CATEGORIES = {
  'home-services': ALL_BOOK_NOW_TASK_CATEGORIES,
  'home_services': ALL_BOOK_NOW_TASK_CATEGORIES,
  handyperson: ALL_BOOK_NOW_TASK_CATEGORIES,
  handyman: ALL_BOOK_NOW_TASK_CATEGORIES,
  cleaning: ['cleaning'],
  'home-cleaning': ['cleaning'],
  repair: ['repair'],
  plumbing: ['repair'],
  electrical: ['repair'],
  electrician: ['repair'],
  carpenter: ['repair'],
  carpentry: ['repair'],
  'ac-service': ['repair'],
  'ac-repair': ['repair'],
  'appliance-repair': ['repair'],
  delivery: ['delivery'],
  'delivery-logistics': ['delivery'],
  driving: ['delivery'],
  assembly: ['assembly'],
  'assembly-services': ['assembly'],
  'furniture-assembly': ['assembly'],
  gardening: ['gardening'],
  petcare: ['petcare'],
  'pet-care': ['petcare'],
  'pet-services': ['petcare'],
  'packers-movers': ['packers-movers'],
  moving: ['packers-movers'],
  other: ['other'],
  painting: ['other'],
  'pest-control': ['other'],
  'beauty-services': ['other'],
  'care-services': ['other'],
  'professional-services': ['other'],
  'event-services': ['other'],
};

function buildPartnerCategoryFilter(partnerCategories) {
  const normalized = partnerCategories
    .map((c) => normalizeCategory(String(c || '')))
    .filter(Boolean);
  if (!normalized.length) return null;
  const taskCategories = new Set();
  normalized.forEach((cat) => {
    const mapped = PARTNER_CATEGORY_TO_TASK_CATEGORIES[cat];
    if (mapped) mapped.forEach((tc) => taskCategories.add(tc));
    else taskCategories.add(cat);
  });
  if (!taskCategories.size) return null;
  return {
    $or: [
      { category: { $in: [...taskCategories] } },
      { categorySlug: { $in: normalized } },
      { categoryLabel: { $in: normalized.map((n) => new RegExp(`^${escapeRegExp(n)}$`, 'i')) } },
    ],
  };
}

function buildPartnerWorkAreaFilter(partnerWorkAreas) {
  const areas = partnerWorkAreas.map((a) => String(a || '').trim()).filter(Boolean);
  if (!areas.length) return null;
  const exactFieldConditions = [];
  const addressConditions = [];
  areas.forEach((area) => {
    const norm = normalizeLocationName(area);
    if (!norm) return;
    const pattern = norm.split(/\s+/).map(escapeRegExp).join('\\s*[-_\\s]+\\s*');
    if (pattern) {
      const eq = new RegExp(`^${pattern}$`, 'i');
      for (const field of ['location.taskArea', 'location.area', 'location.locality', 'location.city']) {
        exactFieldConditions.push({ [field]: eq });
      }
    }
    const contained = norm.split(/\s+/).map(escapeRegExp).join('[\\s_-]+');
    if (contained) {
      addressConditions.push({
        'location.address': new RegExp(`(^|[^a-z0-9])${contained}([^a-z0-9]|$)`, 'i'),
      });
    }
  });
  const orConditions = [];
  if (exactFieldConditions.length) orConditions.push({ $or: exactFieldConditions });
  if (addressConditions.length) orConditions.push({ $or: addressConditions });
  if (!orConditions.length) return null;
  return { $or: orConditions };
}

// Legacy (old) work-area filter — taskArea equality only — kept to prove the gap.
function buildOldWorkAreaFilter(partnerWorkAreas) {
  const regexes = partnerWorkAreas
    .map((a) => String(a || '').trim())
    .filter(Boolean)
    .map((a) => {
      const pattern = normalizeLocationName(a).split(/\s+/).map(escapeRegExp).filter(Boolean).join('[\\s_-]+');
      return pattern ? new RegExp(`^${pattern}$`, 'i') : null;
    })
    .filter(Boolean);
  if (!regexes.length) return null;
  return { 'location.taskArea': { $in: regexes } };
}

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: DB });
  const db = mongoose.connection.db;

  const tasks = await db.collection('tasks').find({ bookingSource: 'book_now', status: 'open' }).toArray();
  const profiles = await db.collection('profiles').find({ 'partnerProfile.status': 'approved' }).toArray();

  console.log(`Open book_now tasks: ${tasks.length}, approved partner profiles: ${profiles.length}\n`);

  const baseFilter = { bookingSource: 'book_now', status: 'open', partnerId: null, partnerUid: null };

  let oldMatchCount = 0;
  let newMatchCount = 0;

  for (const p of profiles) {
    const pp = p.partnerProfile || {};
    const cats = Array.isArray(pp.categories) ? pp.categories : [];
    const areas = Array.isArray(pp.workAreas) ? pp.workAreas : [];

    const category = buildPartnerCategoryFilter(cats);
    const workArea = buildPartnerWorkAreaFilter(areas);
    const oldWorkArea = buildOldWorkAreaFilter(areas);

    console.log(`--- Partner uid=${p.uid} categories=${JSON.stringify(cats)} workAreas=${JSON.stringify(areas)}`);

    if (!category || !workArea) {
      console.log('    → no qualifying categories/work areas: sees 0 leads\n');
      continue;
    }

    const newFilter = { ...baseFilter, $and: [category, workArea] };
    const oldFilter = { ...baseFilter };
    if (category && oldWorkArea) oldFilter.$and = [category, oldWorkArea];

    const newMatches = await db.collection('tasks').find(newFilter).project({ _id: 1, title: 1, category: 1, 'location.taskArea': 1, 'location.city': 1, 'location.address': 1 }).toArray();
    const oldMatches = await db.collection('tasks').find(oldFilter).project({ _id: 1, title: 1 }).toArray();
    newMatchCount += newMatches.length;
    oldMatchCount += oldMatches.length;

    console.log(`    NEW filter matches: ${newMatches.length}`);
    newMatches.forEach((t) => console.log(`      - ${t.title} [cat=${t.category}] [taskArea=${t.location && t.location.taskArea}] [city=${t.location && t.location.city}] [addr=${t.location && t.location.address}]`));
    console.log(`    OLD (taskArea-only) filter matches: ${oldMatches.length}`);
  }

  console.log(`\nTOTAL old-filter matches across all partners: ${oldMatchCount}`);
  console.log(`TOTAL new-filter matches across all partners: ${newMatchCount}`);

  // Prove the geo pipeline executes cleanly (previously invalid: $match before $geoNear)
  console.log('\n=== Geo pipeline test (Hyderabad 17.3850, 78.4867, radius 50km) ===');
  const sampleCats = buildPartnerCategoryFilter(['home_services']);
  const sampleAreas = buildPartnerWorkAreaFilter(['kukatpally', 'secunderabad', 'uppal']);
  const sampleFilter = { ...baseFilter, $and: [sampleCats, sampleAreas] };
  try {
    const geoResults = await db.collection('tasks').aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [78.4867, 17.3850] },
          distanceField: 'distance',
          maxDistance: 50 * 1000,
          spherical: true,
          query: sampleFilter,
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
    ]).toArray();
    console.log(`Geo pipeline OK — returned ${geoResults.length} tasks`);
    geoResults.forEach((t) => console.log(`      - ${t.title} [city=${t.location && t.location.city}]`));
  } catch (err) {
    console.log(`Geo pipeline FAILED: ${err.message}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});