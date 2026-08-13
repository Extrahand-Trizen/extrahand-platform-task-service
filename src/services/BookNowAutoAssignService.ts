import mongoose from 'mongoose';
import type { ITask } from '../models/Task';
import Task from '../models/Task';
import Assignment from '../models/Assignment';
import AssignmentLog from '../models/AssignmentLog';
import logger from '../config/logger';
import { NotificationClient } from './NotificationClient';

// ─── Work Area Coordinates (Hyderabad / Telangana) ───────────────────────────
const WORK_AREA_COORDS: Array<{ area: string; lat: number; lng: number }> = [
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

// ─── Category Slug → Parent Category Mapping ────────────────────────────────
const SLUG_TO_PARENT_CATEGORY: Record<string, string> = {
  electrician: 'electrician',
  'electrician-switch-and-socket': 'electrician',
  'switch-and-socket': 'electrician',
  'electrician-fan-installation': 'electrician',
  'fan-installation': 'electrician',
  'electrician-wiring': 'electrician',
  wiring: 'electrician',
  cleaning: 'cleaning',
  'home-cleaning': 'cleaning',
  'house-cleaning': 'cleaning',
  'deep-cleaning': 'cleaning',
  'cleaning-full-house': 'cleaning',
  'full-house': 'cleaning',
  fullhouse: 'cleaning',
  'cleaning-bathroom': 'cleaning',
  bathroom: 'cleaning',
  'cleaning-kitchen': 'cleaning',
  kitchen: 'cleaning',
  'cleaning-sofa': 'cleaning',
  sofa: 'cleaning',
  'cleaning-mattress': 'cleaning',
  mattress: 'cleaning',
  'cleaning-window-glass': 'cleaning',
  'window-glass': 'cleaning',
  window: 'cleaning',
  glass: 'cleaning',
  carpet: 'cleaning',
  'carpet-cleaning': 'cleaning',
  plumbing: 'plumbing',
  'plumbing-leak': 'plumbing',
  leak: 'plumbing',
  'plumbing-tap-repair': 'plumbing',
  'tap-repair': 'plumbing',
  carpentry: 'carpentry',
  painting: 'painting',
  'ac-repair': 'ac-repair',
  home_services: 'home_services',
  home_service: 'home_services',
};

const PRIMARY_CATEGORIES = new Set([
  'cleaning',
  'electrician',
  'plumbing',
  'carpentry',
  'painting',
  'ac-repair',
  'home_services',
]);

/**
 * Extract the parent category from a task's category, categorySlug, or categoryLabel.
 * e.g. categorySlug: "full-house" (with task.category: "cleaning") → "cleaning"
 */
function extractParentCategory(task: ITask): string {
  // If task.category is already a known primary category, use it directly
  if (task.category && PRIMARY_CATEGORIES.has(String(task.category).toLowerCase())) {
    return String(task.category).toLowerCase();
  }

  const slug = (task as any).categorySlug || task.categoryLabel || '';
  const lower = String(slug).toLowerCase();

  // Direct map lookup
  if (SLUG_TO_PARENT_CATEGORY[lower]) return SLUG_TO_PARENT_CATEGORY[lower];

  // Try prefix or substring match
  for (const [key, parent] of Object.entries(SLUG_TO_PARENT_CATEGORY)) {
    if (lower.startsWith(key + '-') || lower === key || lower.endsWith('-' + key)) return parent;
  }

  // Fallback: use task.category
  return String(task.category || '').toLowerCase();
}

// ─── Haversine Distance ───────────────────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Normalize area name for comparison (strips hyphens, underscores, spaces) ─
function normalizeArea(s: string): string {
  return String(s).toLowerCase().replace(/[-_\s]+/g, '');
}

// ─── Exact Shift Windows based on Partner App Settings ───────────────────────
const SHIFT_WINDOWS: Record<string, { start: number; end: number }> = {
  // Part-Time Options (8 AM-12 PM, 12 PM-4 PM, 3:30 PM-7:30 PM)
  morning_rush: { start: 8.0, end: 12.0 },
  morning_block: { start: 8.0, end: 12.0 },
  midday_block: { start: 12.0, end: 16.0 },
  mid_day_block: { start: 12.0, end: 16.0 },
  afternoon_block: { start: 15.5, end: 19.5 },

  // Full-Time Options (8 AM-4 PM, 10 AM-6 PM, 11:30 AM-7:30 PM)
  morning_full_time: { start: 8.0, end: 16.0 },
  general_day_full_time: { start: 10.0, end: 18.0 },
  evening_full_time: { start: 11.5, end: 19.5 },
};

function parseTaskTime(task: ITask): number {
  if (task.scheduledTimeStart) {
    const m = String(task.scheduledTimeStart).match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const mins = m[2] ? parseInt(m[2], 10) / 60 : 0;
      if (m[3] && m[3].toUpperCase() === 'PM' && h < 12) h += 12;
      if (m[3] && m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      return h + mins;
    }
  }
  if (task.timeSlot) {
    const s = String(task.timeSlot).toLowerCase();
    if (s === 'morning') return 9.0;
    if (s === 'midday') return 13.0;
    if (s === 'afternoon') return 16.0;
    if (s === 'evening') return 18.0;
  }
  return 10.0;
}

function checkTimingMatch(workShifts: string[], task: ITask): boolean {
  if (!workShifts || !Array.isArray(workShifts) || workShifts.length === 0) return false;

  const taskTime = parseTaskTime(task);

  for (const shiftId of workShifts) {
    const key = String(shiftId).toLowerCase().replace(/[-_\s]+/g, '_');
    const window = SHIFT_WINDOWS[key];

    if (window) {
      if (taskTime >= window.start && taskTime <= window.end) return true;
    } else {
      // Fallback substring matching for custom shift keys
      if (key.includes('morning') && taskTime >= 7 && taskTime <= 16) return true;
      if ((key.includes('general') || key.includes('day') || key.includes('mid')) && taskTime >= 9 && taskTime <= 18) return true;
      if ((key.includes('evening') || key.includes('afternoon')) && taskTime >= 11.5 && taskTime <= 19.5) return true;
    }
  }
  return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface EligiblePartner {
  uid: string;
  profileId: string;
  name: string;
  distKm: number | null;
  workArea: string;
  workAreaDistKm: number;
}

interface AutoAssignResult {
  assigned: boolean;
  partner?: EligiblePartner;
  reason?: string;
}

// ─── Main Service ─────────────────────────────────────────────────────────────
export class BookNowAutoAssignService {
  /**
   * Find the best (nearest) eligible approved partner for a Book Now task.
   * Searches the posted work area first, then nearby areas ≤5km, ordered by proximity.
   * Within each area, picks the partner nearest to the task GPS location.
   */
  static async findBestPartner(task: ITask): Promise<EligiblePartner | null> {
    const Profile = mongoose.connection.collection('profiles');

    // Fetch all approved, active partner profiles
    const profiles = await Profile.find({
      isActive: true,
      'partnerProfile.status': 'approved',
    }).toArray();

    if (!profiles.length) return null;

    const taskCoords =
      Array.isArray(task.location?.coordinates) && task.location.coordinates.length === 2
        ? { lng: task.location.coordinates[0], lat: task.location.coordinates[1] }
        : null;

    const postedArea =
      task.location?.taskArea ||
      (task.location as any)?.locality ||
      task.location?.city ||
      '';

    const parentCategory = extractParentCategory(task);

    // Build ordered work area list: posted area (0 km) + nearby ≤5km sorted by distance
    const orderedWorkAreas: Array<{ area: string; distKm: number }> = [
      { area: postedArea, distKm: 0.0 },
    ];

    if (taskCoords && postedArea) {
      WORK_AREA_COORDS.forEach((wa) => {
        if (normalizeArea(wa.area) === normalizeArea(postedArea)) return;
        const dist = haversineKm(taskCoords.lat, taskCoords.lng, wa.lat, wa.lng);
        if (dist <= 5.0) {
          orderedWorkAreas.push({ area: wa.area, distKm: dist });
        }
      });
      orderedWorkAreas.sort((a, b) => a.distKm - b.distKm);
    }

    // Search each work area from nearest to farthest
    for (const wa of orderedWorkAreas) {
      const areaKey = normalizeArea(wa.area);
      const areaPartners: EligiblePartner[] = [];

      for (const p of profiles) {
        const pp = (p.partnerProfile as any) || {};
        if (pp.status !== 'approved') continue;

        const categories: string[] = Array.isArray(pp.categories) ? pp.categories : [];
        const workAreas: string[] = Array.isArray(pp.workAreas)
          ? pp.workAreas
          : Array.isArray(p.helperWorkAreas)
          ? (p.helperWorkAreas as string[])
          : [];

        if (!categories.length || !workAreas.length) continue;

        // ① Category match: partner's registered category must match task parent category
        const normCategories = categories.map((c: string) => normalizeArea(c));
        const normParent = normalizeArea(parentCategory);
        const categoryMatches =
          normCategories.some((c: string) => c === normParent || c.includes(normParent) || normParent.includes(c));
        if (!categoryMatches) continue;

        // ② Work area match (hyphen/space normalized)
        const normAreas = workAreas.map((a: string) => normalizeArea(a));
        const areaMatches = normAreas.some((a: string) => a === areaKey || a.includes(areaKey) || areaKey.includes(a));
        if (!areaMatches) continue;

        // ③ Shift timing match (must have selected shifts AND they must cover task time)
        const workShifts: string[] = Array.isArray(pp.workShifts) ? pp.workShifts : [];
        if (!checkTimingMatch(workShifts, task)) continue;

        // ④ Calculate distance from task location to partner's home location
        let distKm: number | null = null;
        const pCoords: number[] | undefined =
          (p.homeLocation as any)?.coordinates || (p.location as any)?.coordinates;
        if (
          taskCoords &&
          Array.isArray(pCoords) &&
          pCoords.length === 2 &&
          typeof pCoords[1] === 'number' &&
          (pCoords[0] !== 0 || pCoords[1] !== 0)
        ) {
          // Use homeLocation preferentially for distance (more stable than live location)
          const homeLoc = (p.homeLocation as any)?.coordinates;
          const liveLoc = (p.location as any)?.coordinates;
          const coords = (Array.isArray(homeLoc) && homeLoc.length === 2) ? homeLoc : liveLoc;
          if (coords) {
            distKm = haversineKm(taskCoords.lat, taskCoords.lng, coords[1], coords[0]);
          }
        }

        areaPartners.push({
          uid: String(p.uid),
          profileId: String(p._id),
          name: (p.name || p.fullName || 'Partner') as string,
          distKm,
          workArea: wa.area,
          workAreaDistKm: wa.distKm,
        });
      }

      if (areaPartners.length === 0) continue;

      // Sort: partners with valid GPS distance first (nearest first), then those without coords
      areaPartners.sort((a, b) => {
        if (a.distKm === null && b.distKm === null) return 0;
        if (a.distKm === null) return 1;
        if (b.distKm === null) return -1;
        return a.distKm - b.distKm;
      });

      // Return the best partner in this area
      return areaPartners[0];
    }

    return null;
  }

  /**
   * Auto-assign the Book Now task to the best matching partner.
   * Directly sets task.partnerId / partnerUid / status = 'assigned'.
   * No notification is sent — partner sees it when they open the app.
   */
  static async autoAssign(task: ITask): Promise<AutoAssignResult> {
    const taskId = String(task._id);

    try {
      const best = await BookNowAutoAssignService.findBestPartner(task);

      if (!best) {
        const postedArea = task.location?.taskArea || (task.location as any)?.locality || task.location?.city || 'N/A';
        const timeInfo = task.scheduledTimeStart || task.timeSlot || 'Flexible';
        const catInfo = (task as any).categoryLabel || task.category || 'N/A';

        logger.info(`================================================================================`);
        logger.info(`📢 [BookNowWorkPosted] BOOK NOW WORK POSTED!`);
        logger.info(`   Task ID           : ${taskId}`);
        logger.info(`   Task Title        : "${task.title}"`);
        logger.info(`   Category          : ${catInfo}`);
        logger.info(`   Work Posted Area  : ${postedArea}`);
        logger.info(`   Work Scheduled    : ${timeInfo}`);
        logger.info(`--------------------------------------------------------------------------------`);
        logger.info(`⚠️ NO PARTNER FOUND (Within 5 km work areas)`);
        logger.info(`   Task remains unassigned for manual operations assignment.`);
        logger.info(`================================================================================`);
        return { assigned: false, reason: 'No eligible approved partner found within 5km work areas' };
      }

      const partnerProfileObjId = new mongoose.Types.ObjectId(best.profileId);

      // Cancel any existing active assignments (clean slate)
      await Assignment.updateMany(
        { taskId: task._id, status: { $in: ['assigned', 'pending'] } },
        { $set: { status: 'cancelled' } }
      );

      // Resolve bookingOrderId / bookingItemId for audit
      let bookingOrderId = (task as any).bookingOrderId;
      let bookingItemId = (task as any).bookingItemId;

      // Create assignment record
      const assignment = await Assignment.create({
        bookingOrderId: bookingOrderId || 'auto',
        bookingItemId: bookingItemId
          ? new mongoose.Types.ObjectId(bookingItemId)
          : task._id,
        taskId: task._id,
        helperUid: best.uid,
        helperProfileId: partnerProfileObjId,
        assignmentMode: 'auto',
        status: 'assigned',
        assignedByUid: 'system',
        assignedAt: new Date(),
      });

      // Log the auto-assignment action
      await AssignmentLog.create({
        assignmentId: assignment._id,
        action: 'auto_partner_assign_book_now',
        actorUid: 'system',
        metadata: {
          partnerUid: best.uid,
          partnerProfileId: best.profileId,
          workArea: best.workArea,
          workAreaDistKm: best.workAreaDistKm,
          partnerDistKm: best.distKm,
        },
      });

      // Update the task: set partnerId/partnerUid so it shows in partner's my-leads
      // Do NOT set acceptedApplicationId — no TaskApplication is created
      await Task.findByIdAndUpdate(
        task._id,
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
        },
        { new: true }
      );

      const distStr = best.distKm !== null ? `${best.distKm.toFixed(2)} km` : 'Location Not Set';

      const postedArea = task.location?.taskArea || (task.location as any)?.locality || task.location?.city || 'N/A';
      const timeInfo = task.scheduledTimeStart || task.timeSlot || 'Flexible';
      const catInfo = (task as any).categoryLabel || task.category || 'N/A';

      logger.info(`================================================================================`);
      logger.info(`📢 [BookNowWorkPosted] BOOK NOW WORK POSTED!`);
      logger.info(`   Task ID           : ${taskId}`);
      logger.info(`   Task Title        : "${task.title}"`);
      logger.info(`   Category          : ${catInfo}`);
      logger.info(`   Work Posted Area  : ${postedArea}`);
      logger.info(`   Work Scheduled    : ${timeInfo}`);
      logger.info(`--------------------------------------------------------------------------------`);
      logger.info(`✅ PARTNER FOUND AND AUTO-ASSIGNED:`);
      logger.info(`   Partner Name      : ${best.name}`);
      logger.info(`   Partner UID       : ${best.uid}`);
      logger.info(`   Partner Profile ID: ${best.profileId}`);
      logger.info(`   Assigned Work Area: "${best.workArea}" (${best.workAreaDistKm.toFixed(2)} km from task location)`);
      logger.info(`   Partner Distance  : ${distStr}`);
      logger.info(`================================================================================`);

      // Send ring notification to the assigned partner
      try {
        const categoryLabel = (task as any).categoryLabel || task.category || 'service';
        await NotificationClient.send({
          eventKey: 'BOOK_NOW_PARTNER_ASSIGNED',
          category: 'taskUpdates',
          recipients: [best.uid],
          entity: { type: 'task', id: taskId },
          title: 'New Book Now Work Assigned!',
          body: `${task.title || categoryLabel} - Tap to view details`,
          data: {
            taskId,
            bookingSource: 'book_now',
            eventKey: 'BOOK_NOW_PARTNER_ASSIGNED',
            partnerName: best.name,
            workArea: best.workArea,
          },
        });
        logger.info(`[BookNowAutoAssign] 🔔 Ring notification sent to partner ${best.uid} for task ${taskId}`);
      } catch (notifErr) {
        // Notification failure is non-critical — log but don't fail the assignment
        logger.warn(`[BookNowAutoAssign] ⚠️ Failed to send ring notification for task ${taskId}:`, notifErr);
      }

      return { assigned: true, partner: best };
    } catch (err) {
      logger.error(`[BookNowAutoAssign] ❌ Error during auto-assignment for task ${taskId}:`, err);
      return { assigned: false, reason: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}
