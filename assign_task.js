const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

const TARGET_TASK_ID = '6a7d5cf2ebddb8736a1f785d';

const WORK_AREA_COORDS = [
  { area: 'Secunderabad', lat: 17.4399, lng: 78.4983 },
  { area: 'Malkajgiri', lat: 17.4478, lng: 78.5382 },
  { area: 'Tarnaka', lat: 17.4278, lng: 78.5284 },
  { area: 'Uppal', lat: 17.4056, lng: 78.5594 },
  { area: 'LB Nagar', lat: 17.3457, lng: 78.5522 },
  { area: 'Kukatpally', lat: 17.4849, lng: 78.4074 },
  { area: 'Ameerpet', lat: 17.4375, lng: 78.4482 },
  { area: 'Moti Nagar', lat: 17.4532, lng: 78.4215 },
  { area: 'Madhapur', lat: 17.4483, lng: 78.3915 },
  { area: 'Gachibowli', lat: 17.4401, lng: 78.3489 },
  { area: 'Hitec City', lat: 17.4435, lng: 78.3772 },
  { area: 'Begumpet', lat: 17.4448, lng: 78.4661 },
  { area: 'Koti', lat: 17.3850, lng: 78.4867 },
  { area: 'Banjara Hills', lat: 17.4156, lng: 78.4347 },
  { area: 'Jubilee Hills', lat: 17.4319, lng: 78.4071 },
];

const SLUG_TO_PARENT = {
  'electrician': 'electrician',
  'electrician-switch-and-socket': 'electrician',
  'electrician-fan-installation': 'electrician',
  'cleaning': 'cleaning',
  'cleaning-full-house': 'cleaning',
  'plumbing': 'plumbing',
  'carpentry': 'carpentry',
  'painting': 'painting',
  'home_services': 'home_services',
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeArea(s) {
  return String(s).toLowerCase().replace(/[-_\s]+/g, '');
}

const PRIMARY_CATEGORIES = new Set([
  'cleaning',
  'electrician',
  'plumbing',
  'carpentry',
  'painting',
  'ac-repair',
  'home_services',
]);

function extractParentCategory(task) {
  if (task.category && PRIMARY_CATEGORIES.has(String(task.category).toLowerCase())) {
    return String(task.category).toLowerCase();
  }
  const slug = task.categorySlug || task.categoryLabel || '';
  const lower = String(slug).toLowerCase();
  if (SLUG_TO_PARENT[lower]) return SLUG_TO_PARENT[lower];
  for (const [key, parent] of Object.entries(SLUG_TO_PARENT)) {
    if (lower.startsWith(key + '-') || lower === key || lower.endsWith('-' + key)) return parent;
  }
  return String(task.category || '').toLowerCase();
}

function checkTimingMatch(workShifts, task) {
  if (!workShifts || workShifts.length === 0) return false;
  let startHour = 10;
  if (task.scheduledTimeStart) {
    const m = String(task.scheduledTimeStart).match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
    if (m) {
      let h = parseInt(m[1], 10);
      if (m[3] && m[3].toUpperCase() === 'PM' && h < 12) h += 12;
      if (m[3] && m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      startHour = h;
    }
  } else if (task.timeSlot) {
    const s = String(task.timeSlot).toLowerCase();
    if (s === 'morning') startHour = 9;
    else if (s === 'midday') startHour = 13;
    else if (s === 'afternoon') startHour = 16;
    else if (s === 'evening') startHour = 19;
  }
  for (const shiftId of workShifts) {
    const s = String(shiftId).toLowerCase();
    if (s.includes('morning') && startHour >= 7 && startHour < 12) return true;
    if ((s.includes('general') || s.includes('day') || s.includes('mid')) && startHour >= 9 && startHour < 17) return true;
    if ((s.includes('evening') || s.includes('afternoon')) && startHour >= 12 && startHour < 22) return true;
  }
  return false;
}

async function run() {
  await mongoose.connect(MONGO_URI, { dbName: DB });
  const db = mongoose.connection.db;

  let task = null;
  try {
    const oid = new mongoose.Types.ObjectId(TARGET_TASK_ID);
    task = await db.collection('tasks').findOne({ _id: oid });
  } catch (err) {
    task = await db.collection('tasks').findOne({ _id: TARGET_TASK_ID });
  }

  if (!task) {
    console.error(`Task ${TARGET_TASK_ID} not found in database.`);
    process.exit(1);
  }

  const profiles = await db.collection('profiles').find({
    isActive: true,
    'partnerProfile.status': 'approved',
  }).toArray();

  const taskCoords = Array.isArray(task.location?.coordinates) && task.location.coordinates.length === 2
    ? { lng: task.location.coordinates[0], lat: task.location.coordinates[1] }
    : null;

  const postedArea = task.location?.taskArea || task.location?.locality || task.location?.city || 'Secunderabad';
  const parentCategory = extractParentCategory(task);
  const timeInfo = task.scheduledTimeStart || task.timeSlot || 'Flexible';
  const catInfo = task.categoryLabel || task.category || 'N/A';

  console.log(`================================================================================`);
  console.log(`📢 [BookNowWorkPosted] BOOK NOW WORK POSTED!`);
  console.log(`   Task ID           : ${task._id}`);
  console.log(`   Task Title        : "${task.title}"`);
  console.log(`   Category          : ${catInfo} (Parent: ${parentCategory})`);
  console.log(`   Work Posted Area  : ${postedArea}`);
  console.log(`   Work Scheduled    : ${timeInfo}`);
  console.log(`   Approved Profiles : ${profiles.length} total in DB`);
  console.log(`================================================================================\n`);

  const orderedWorkAreas = [{ area: postedArea, distKm: 0.0 }];
  if (taskCoords && postedArea) {
    WORK_AREA_COORDS.forEach(wa => {
      if (normalizeArea(wa.area) === normalizeArea(postedArea)) return;
      const dist = haversineKm(taskCoords.lat, taskCoords.lng, wa.lat, wa.lng);
      if (dist <= 5.0) orderedWorkAreas.push({ area: wa.area, distKm: dist });
    });
    orderedWorkAreas.sort((a, b) => a.distKm - b.distKm);
  }

  let best = null;

  for (const wa of orderedWorkAreas) {
    const areaKey = normalizeArea(wa.area);
    const areaPartners = [];

    for (const p of profiles) {
      const pp = p.partnerProfile || {};
      if (pp.status !== 'approved') continue;
      const categories = Array.isArray(pp.categories) ? pp.categories : [];
      const workAreas = Array.isArray(pp.workAreas) ? pp.workAreas : [];
      if (!categories.length || !workAreas.length) continue;

      const normCats = categories.map(c => normalizeArea(c));
      const normParent = normalizeArea(parentCategory);
      if (!normCats.some(c => c === normParent || c.includes(normParent) || normParent.includes(c))) continue;

      const normAreas = workAreas.map(a => normalizeArea(a));
      if (!normAreas.some(a => a === areaKey || a.includes(areaKey) || areaKey.includes(a))) continue;

      const workShifts = Array.isArray(pp.workShifts) ? pp.workShifts : [];
      if (!checkTimingMatch(workShifts, task)) continue;

      let distKm = null;
      const homeLoc = p.homeLocation?.coordinates;
      const liveLoc = p.location?.coordinates;
      const coords = (Array.isArray(homeLoc) && homeLoc.length === 2) ? homeLoc : liveLoc;
      if (taskCoords && Array.isArray(coords) && coords.length === 2 && (coords[0] !== 0 || coords[1] !== 0)) {
        distKm = haversineKm(taskCoords.lat, taskCoords.lng, coords[1], coords[0]);
      }

      areaPartners.push({ uid: p.uid, profileId: String(p._id), name: p.name || p.fullName || 'Partner', distKm, workArea: wa.area, workAreaDistKm: wa.distKm });
    }

    if (areaPartners.length > 0) {
      areaPartners.sort((a, b) => {
        if (a.distKm === null && b.distKm === null) return 0;
        if (a.distKm === null) return 1;
        if (b.distKm === null) return -1;
        return a.distKm - b.distKm;
      });
      best = areaPartners[0];
      break;
    }
  }

  if (best) {
    const partnerProfileObjId = new mongoose.Types.ObjectId(best.profileId);
    const distStr = best.distKm !== null ? `${best.distKm.toFixed(2)} km` : 'Location Not Set';

    // Perform actual database assignment!
    await db.collection('tasks').updateOne(
      { _id: task._id },
      {
        $set: {
          assigneeId: partnerProfileObjId,
          assigneeUid: best.uid,
          assigneeName: best.name,
          assignedHelperName: best.name,
          assignedToName: best.name,
          partnerId: partnerProfileObjId,
          partnerUid: best.uid,
          partnerAcceptedAt: new Date(),
          assignedAt: new Date(),
          status: 'assigned',
          assignmentStatus: 'assigned',
        },
      }
    );

    console.log(`================================================================================`);
    console.log(`✅ PARTNER FOUND AND AUTO-ASSIGNED:`);
    console.log(`   Partner Name      : ${best.name}`);
    console.log(`   Partner UID       : ${best.uid}`);
    console.log(`   Partner Profile ID: ${best.profileId}`);
    console.log(`   Assigned Work Area: "${best.workArea}" (${best.workAreaDistKm.toFixed(2)} km from task location)`);
    console.log(`   Partner Distance  : ${distStr}`);
    console.log(`================================================================================\n`);
  } else {
    console.log(`================================================================================`);
    console.log(`⚠️ NO PARTNER FOUND (Within 5 km work areas)`);
    console.log(`   Task remains unassigned for manual operations assignment.`);
    console.log(`================================================================================\n`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
