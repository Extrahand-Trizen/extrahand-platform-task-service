const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: DB });
  const db = mongoose.connection.db;

  const tasks = await db.collection('tasks')
    .find({ bookingSource: 'book_now', status: 'open' })
    .toArray();

  console.log('=== OPEN BOOK_NOW TASKS (' + tasks.length + ') ===');
  tasks.forEach((t) => {
    console.log(JSON.stringify({
      _id: String(t._id),
      title: t.title,
      category: t.category,
      categorySlug: t.categorySlug,
      categoryLabel: t.categoryLabel,
      taskArea: t.location && t.location.taskArea,
      city: t.location && t.location.city,
      address: t.location && t.location.address,
    }));
  });

  console.log('\n=== Distinct taskArea values ===');
  const areas = [...new Set(tasks.map((t) => t.location && t.location.taskArea).filter(Boolean))];
  console.log(JSON.stringify(areas, null, 2));

  const profiles = await db.collection('profiles')
    .find({ 'partnerProfile.status': 'approved' })
    .toArray();
  console.log('\n=== APPROVED PARTNER PROFILES (' + profiles.length + ') ===');
  profiles.slice(0, 15).forEach((p) => {
    console.log(JSON.stringify({
      _id: String(p._id),
      uid: p.uid,
      roles: p.roles,
      supplyPrograms: p.supplyPrograms,
      partnerCategories: p.partnerProfile && p.partnerProfile.categories,
      partnerWorkAreas: p.partnerProfile && p.partnerProfile.workAreas,
      helperWorkAreas: p.helperWorkAreas,
      location: p.location && { city: p.location.city, area: p.location.area },
    }));
  });

  console.log('\n=== Distinct partnerProfile.workAreas values ===');
  const pAreas = new Set();
  profiles.forEach((p) => (p.partnerProfile && p.partnerProfile.workAreas || []).forEach((a) => pAreas.add(a)));
  console.log(JSON.stringify([...pAreas], null, 2));

  console.log('\n=== Distinct partnerProfile.categories values ===');
  const pCats = new Set();
  profiles.forEach((p) => (p.partnerProfile && p.partnerProfile.categories || []).forEach((c) => pCats.add(c)));
  console.log(JSON.stringify([...pCats], null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});