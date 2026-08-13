const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

const TARGET_TASK_ID = '6a7c056a4aea573e5bad61bb';

const WORK_AREA_COORDINATES = [
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

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getTaskHourRange(task) {
  if (task.scheduledTimeStart) {
    const match = String(task.scheduledTimeStart).match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const isPm = match[3] && match[3].toUpperCase() === 'PM';
      const isAm = match[3] && match[3].toUpperCase() === 'AM';
      if (isPm && h < 12) h += 12;
      if (isAm && h === 12) h = 0;
      return { startHour: h, endHour: h + 2 };
    }
  }
  const slot = String(task.timeSlot || '').toLowerCase();
  if (slot === 'morning') return { startHour: 8, endHour: 12 };
  if (slot === 'midday') return { startHour: 12, endHour: 15 };
  if (slot === 'afternoon') return { startHour: 15, endHour: 18 };
  if (slot === 'evening') return { startHour: 18, endHour: 21 };

  return { startHour: 9, endHour: 17 };
}

function isShiftTimingMatched(partnerShiftType, partnerWorkShifts, task) {
  // STRICT REQUIREMENT: if partner has NOT selected any shift timings, DO NOT CONSIDER THEM
  if (!partnerWorkShifts || !Array.isArray(partnerWorkShifts) || partnerWorkShifts.length === 0) {
    return false;
  }
  const { startHour } = getTaskHourRange(task);
  for (const shiftId of partnerWorkShifts) {
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
    console.error(`Task with ID ${TARGET_TASK_ID} not found in database.`);
    process.exit(1);
  }

  // Fetch approved partners ONLY
  const approvedProfiles = await db.collection('profiles').find({
    isActive: true,
    'partnerProfile.status': 'approved',
  }).toArray();

  const taskLat = task.location?.coordinates ? task.location.coordinates[1] : 17.4399;
  const taskLng = task.location?.coordinates ? task.location.coordinates[0] : 78.4983;
  const postedAreaName = task.location?.taskArea || task.location?.locality || task.location?.city || 'Secunderabad';
  const taskTimeInfo = task.scheduledTimeStart || task.timeSlot || 'Morning / Flexible';

  console.log(`================================================================================`);
  console.log(`📋 [BookNowTaskCreated] New Book Now Task: "${task.title}" (${task._id})`);
  console.log(`   Category          : ${task.categoryLabel || task.category || 'N/A'}`);
  console.log(`   Work Scheduled    : ${taskTimeInfo}`);
  console.log(`   Work Posted Area  : ${postedAreaName}`);
  console.log(`   Approved Profiles : ${approvedProfiles.length} total approved partner profiles in DB`);
  console.log(`================================================================================\n`);

  // Build ordered list of work areas by distance from work location
  const orderedWorkAreas = [
    { area: postedAreaName, distKm: 0.0, isPosted: true },
  ];

  WORK_AREA_COORDINATES.forEach((wa) => {
    if (wa.area.toLowerCase() === postedAreaName.toLowerCase()) return;
    const dist = haversineDistanceKm(taskLat, taskLng, wa.lat, wa.lng);
    if (dist <= 5.0) {
      orderedWorkAreas.push({ area: wa.area, distKm: dist, isPosted: false });
    }
  });

  orderedWorkAreas.sort((a, b) => a.distKm - b.distKm);

  console.log(`📌 WORK AREAS ORDERED BY NEAREST DISTANCE FROM WORK LOCATION:`);
  orderedWorkAreas.forEach((wa, i) => {
    const label = wa.isPosted ? '(Work Posted Area)' : `(Nearest Work Area #${i})`;
    console.log(`   ${i + 1}. ${wa.area} - ${wa.distKm.toFixed(2)} km away ${label}`);
  });
  console.log(`--------------------------------------------------------------------------------\n`);

  const summaryRows = [];

  orderedWorkAreas.forEach((wa, waIdx) => {
    const areaNameNorm = wa.area.toLowerCase();
    const areaPartners = [];

    approvedProfiles.forEach((p) => {
      const pp = p.partnerProfile || {};
      if (pp.status !== 'approved') return;

      const workAreas = Array.isArray(pp.workAreas) ? pp.workAreas : (Array.isArray(p.helperWorkAreas) ? p.helperWorkAreas : []);
      const categories = Array.isArray(pp.categories) ? pp.categories : [];
      if (!categories.length || !workAreas.length) return;

      // Normalize: remove hyphens/underscores/spaces for comparison
      const normalize = (s) => String(s).toLowerCase().replace(/[-_\s]+/g, '');
      const normAreas = workAreas.map(a => normalize(a));
      const areaKey = normalize(wa.area);
      const isMatch = normAreas.some(a => a.includes(areaKey) || areaKey.includes(a));
      if (!isMatch) return;

      const shiftType = pp.workShiftType || 'full_time';
      const shiftIds = Array.isArray(pp.workShifts) ? pp.workShifts : [];

      // STRICT SHIFT CHECK: Must have selected shifts AND must match task timing
      if (!isShiftTimingMatched(shiftType, shiftIds, task)) return;

      let distKm = null;
      const pCoords = p.location?.coordinates || p.homeLocation?.coordinates;
      if (Array.isArray(pCoords) && pCoords.length === 2 && typeof pCoords[1] === 'number' && (pCoords[0] !== 0 || pCoords[1] !== 0)) {
        distKm = haversineDistanceKm(taskLat, taskLng, pCoords[1], pCoords[0]);
      } else {
        distKm = wa.distKm + (areaPartners.length + 1) * 0.12;
      }

      areaPartners.push({
        id: String(p._id),
        uid: p.uid || 'N/A',
        name: p.name || p.fullName || 'Partner',
        distanceKm: distKm,
        workAreas,
        categories,
        shiftType,
        shiftIds,
      });
    });

    areaPartners.sort((a, b) => a.distanceKm - b.distanceKm);

    summaryRows.push({ area: wa.area, distKm: wa.distKm, isPosted: wa.isPosted, count: areaPartners.length });

    const areaLabel = wa.isPosted ? 'WORK POSTED AREA' : `NEARBY AREA - ${wa.distKm.toFixed(2)} km away`;
    console.log(`\n┌─────────────────────────────────────────────────────────────────────────────┐`);
    console.log(`│  📍 ${`WORK AREA ${waIdx + 1}: "${wa.area.toUpperCase()}" (${areaLabel})`.padEnd(73)}│`);
    console.log(`│     Partners Found: ${String(areaPartners.length).padEnd(56)}│`);
    console.log(`└─────────────────────────────────────────────────────────────────────────────┘`);

    if (areaPartners.length === 0) {
      console.log(`   ⚠️  0 partners matched (check category / shift timings / work area registration)`);
    } else {
      areaPartners.forEach((h, idx) => {
        const distStr = h.distanceKm !== null ? `${h.distanceKm.toFixed(2)} km` : 'Location Not Set';
        console.log(`   Rank #${idx + 1}`);
        console.log(`      Name          : ${h.name}`);
        console.log(`      UID           : ${h.uid}`);
        console.log(`      Profile ID    : ${h.id}`);
        console.log(`      Distance      : ${distStr}`);
        console.log(`      Work Areas    : [${h.workAreas.join(', ')}]`);
        console.log(`      Categories    : [${h.categories.join(', ')}]`);
        console.log(`      Shift Type    : ${h.shiftType}`);
        console.log(`      Shifts        : [${h.shiftIds.join(', ')}]`);
        console.log(`      Timing Match  : ✅ MATCHED`);
        if (idx < areaPartners.length - 1) console.log(`      - - - - - - - - - - - - - - - - - - -`);
      });
    }
  });

  // Summary table at end
  console.log(`\n\n================================================================================`);
  console.log(`📊 SUMMARY - ALL WORK AREAS & PARTNER COUNT FOR TASK: ${task._id}`);
  console.log(`================================================================================`);
  console.log(`  #  | Work Area         | Distance  | Type              | Partners Found`);
  console.log(`-----|-------------------|-----------|-------------------|----------------`);
  summaryRows.forEach((row, i) => {
    const areaCol = row.area.padEnd(17);
    const distCol = `${row.distKm.toFixed(2)} km`.padEnd(9);
    const typeCol = (row.isPosted ? 'Posted Area' : 'Nearby Area').padEnd(17);
    const countCol = row.count === 0 ? '0 (No Match)' : `${row.count} Partner(s)`;
    console.log(`  ${String(i + 1).padEnd(3)}| ${areaCol}| ${distCol}| ${typeCol}| ${countCol}`);
  });
  console.log(`================================================================================\n`);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
