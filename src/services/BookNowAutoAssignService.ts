import mongoose from 'mongoose';
import type { ITask } from '../models/Task';
import Task from '../models/Task';
import Assignment from '../models/Assignment';
import AssignmentLog from '../models/AssignmentLog';
import BookingItem from '../models/BookingItem';
import BookingOrder from '../models/BookingOrder';
import logger from '../config/logger';
import { NotificationClient } from './NotificationClient';
import { PaymentClient } from './PaymentClient';
import { HYDERABAD_WORK_AREA_COORDS } from '../constants/locations/hyderabadWorkAreaCoords';
import { config } from '../config/env';
import { resolvePartnerUidByPhone } from '../utils/resolvePartnerUidByPhone';
import {
  isHomeCleaningTask,
  partnerCategoryMatchesBookNowTask,
} from './partnerVisibility';
import { notifyBookNowAssignment } from './AssignmentService';
import AssignmentManagementRules from '../models/AssignmentManagementRules';
import { workShiftsCoverInterval } from '../utils/bookNowSlotAvailability';
import { buildHourlyServiceAreaCandidates } from '../utils/hourlyHelperServiceArea';
import { matchEligibleHourlyHelperArea } from './HourlyHelperAvailabilityService';
import { BadRequestError, ForbiddenError } from '../errors/AppError';

const OFFER_WINDOW_MS = 30 * 60 * 1000;
const OFFER_STAGES = ['preferred', 'area_rule', 'all'] as const;
type OfferStage = (typeof OFFER_STAGES)[number];
type DispatchCurrentStage = OfferStage | 'assigned' | 'closed';
const SUPPORT_ESCALATION_MS = 2 * 60 * 60 * 1000;

// ─── Work Area Coordinates (Hyderabad / Telangana) ───────────────────────────
const WORK_AREA_COORDS = HYDERABAD_WORK_AREA_COORDS;

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

function extractParentCategory(task: ITask): string {
  const slug = String((task as any).categorySlug || task.categoryLabel || '')
    .trim()
    .toLowerCase();
  const subcategory = String(task.subcategory || '')
    .trim()
    .toLowerCase();
  if (
    slug === 'painting' ||
    slug.startsWith('painting-') ||
    subcategory.startsWith('painting-consultation-') ||
    subcategory.startsWith('consultation-project-') ||
    ['interior-painting', 'exterior-painting', 'rental-painting', 'waterproofing'].includes(slug)
  ) {
    return 'painting';
  }
  if (String(task.serviceType || '').trim().toLowerCase() === 'painting') {
    return 'painting';
  }
  if (
    String((task as any).serviceFlowType || '').trim() === 'consultation_project'
  ) {
    const serviceType = String(task.serviceType || '').trim().toLowerCase();
    if (!serviceType || serviceType === 'painting') {
      return 'painting';
    }
  }
  if (task.category && PRIMARY_CATEGORIES.has(String(task.category).toLowerCase())) {
    return String(task.category).toLowerCase();
  }
  const lower = slug;
  if (SLUG_TO_PARENT_CATEGORY[lower]) return SLUG_TO_PARENT_CATEGORY[lower];
  for (const [key, parent] of Object.entries(SLUG_TO_PARENT_CATEGORY)) {
    if (lower.startsWith(key + '-') || lower === key || lower.endsWith('-' + key)) return parent;
  }
  return String(task.category || '').toLowerCase();
}

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

function normalizeArea(s: string): string {
  return String(s).toLowerCase().replace(/[-_\s]+/g, '');
}

function normalizePhone(phone: unknown): string {
  return String(phone || '').replace(/\D/g, '');
}

function phoneMatchesExcluded(phone: unknown, excludedPhones: string[]): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const lastTen = normalized.slice(-10);
  return excludedPhones.some((excluded) => {
    const normalizedExcluded = normalizePhone(excluded);
    return normalizedExcluded === normalized || normalizedExcluded.slice(-10) === lastTen;
  });
}

const SHIFT_WINDOWS: Record<string, { start: number; end: number; label: string }> = {
  morning_rush: { start: 8.0, end: 12.0, label: '9am-1pm' },
  morning_block: { start: 8.0, end: 12.0, label: '9am-1pm' },
  midday_block: { start: 12.0, end: 16.0, label: '12-4pm' },
  mid_day_block: { start: 12.0, end: 16.0, label: '12-4pm' },
  afternoon_block: { start: 15.5, end: 19.5, label: '3:30-7:30pm' },
  morning_full_time: { start: 8.0, end: 16.0, label: '8am-4pm' },
  general_day_full_time: { start: 10.0, end: 18.0, label: '10am-6pm' },
  evening_full_time: { start: 11.5, end: 19.5, label: '1-9pm' },
};

function formatShiftLabel(shiftKeys?: string[]): string {
  if (!shiftKeys || !shiftKeys.length) return '9am-1pm';
  const key = String(shiftKeys[0]).toLowerCase().replace(/[-_\s]+/g, '_');
  return SHIFT_WINDOWS[key]?.label || '9am-1pm';
}

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
    if (s === 'afternoon') return 14.5;
    if (s === 'evening') return 18.0;
  }
  return 14.5; // default 2:30pm
}

function formatTaskTimeDisplay(task: ITask): string {
  if (task.scheduledTimeStart) {
    return String(task.scheduledTimeStart).toLowerCase().replace(/\s+/g, '');
  }
  if (task.timeSlot) {
    const s = String(task.timeSlot).toLowerCase();
    if (s === 'morning') return '9am';
    if (s === 'midday') return '1pm';
    if (s === 'afternoon') return '2:30pm';
    if (s === 'evening') return '6pm';
  }
  return '2:30pm';
}

function checkTimingMatch(workShifts: string[], task: ITask): boolean {
  const bookingKind = String((task as any).bookingKind || '').trim().toLowerCase();
  if (bookingKind === 'consultation') {
    // Site-survey consultations: partner travels; any configured shift (or none) is acceptable.
    return true;
  }

  // Some approved legacy partner profiles do not have shift slots backfilled yet.
  // Do not block auto-assignment when category and work-area already match.
  if (!workShifts || !Array.isArray(workShifts) || workShifts.length === 0) return true;

  if (isHourlyTask(task) && task.scheduledTimeStart) {
    const parseMinutes = (label: string): number | null => {
      const match = String(label || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!match) return null;
      let hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (!Number.isInteger(hours) || hours < 1 || hours > 12 || minutes > 59) return null;
      if (match[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    };
    const startMinutes = parseMinutes(task.scheduledTimeStart);
    if (startMinutes == null) return false;
    const scheduledEnd = parseMinutes(String(task.scheduledTimeEnd || ''));
    const estimatedDuration = Number(task.estimatedDuration || 0);
    const endMinutes = scheduledEnd != null && scheduledEnd > startMinutes
      ? scheduledEnd
      : startMinutes + (Number.isFinite(estimatedDuration) && estimatedDuration > 0
          ? estimatedDuration
          : 30);
    return workShiftsCoverInterval(workShifts, startMinutes, endMinutes, true);
  }

  const taskTime = parseTaskTime(task);
  for (const shiftId of workShifts) {
    const key = String(shiftId).toLowerCase().replace(/[-_\s]+/g, '_');
    const window = SHIFT_WINDOWS[key];
    if (window) {
      if (taskTime >= window.start && taskTime <= window.end) return true;
    } else {
      if (key.includes('morning') && taskTime >= 7 && taskTime <= 16) return true;
      if ((key.includes('general') || key.includes('day') || key.includes('mid')) && taskTime >= 9 && taskTime <= 18) return true;
      if ((key.includes('evening') || key.includes('afternoon')) && taskTime >= 11.5 && taskTime <= 19.5) return true;
    }
  }
  return false;
}

export function buildOrderedWorkAreasForDispatch(task: ITask): Array<{ area: string; distKm: number }> {
  const taskCoords =
    Array.isArray(task.location?.coordinates) && task.location.coordinates.length === 2
      ? { lng: task.location.coordinates[0], lat: task.location.coordinates[1] }
      : null;

  const locationAreas = [
    task.location?.taskArea,
    (task.location as any)?.locality,
    task.location?.city,
  ]
    .map((area) => String(area || '').trim())
    .filter((area, index, areas) =>
      Boolean(area) &&
      areas.findIndex((candidate) => normalizeArea(candidate) === normalizeArea(area)) === index,
    );
  const orderedWorkAreas: Array<{ area: string; distKm: number }> = locationAreas.map(
    (area) => ({ area, distKm: 0 }),
  );

  const referenceArea = locationAreas
    .map((area) => WORK_AREA_COORDS.find((workArea) => normalizeArea(workArea.area) === normalizeArea(area)))
    .find(Boolean);
  const refCoord = taskCoords || referenceArea;

  if (refCoord) {
    WORK_AREA_COORDS.forEach((wa) => {
      if (locationAreas.some((area) => normalizeArea(area) === normalizeArea(wa.area))) return;
      const dist = haversineKm(refCoord.lat, refCoord.lng, wa.lat, wa.lng);
      if (dist <= 6.0) {
        orderedWorkAreas.push({ area: wa.area, distKm: Math.round(dist * 10) / 10 });
      }
    });
  }

  orderedWorkAreas.sort((a, b) => a.distKm - b.distKm);

  return orderedWorkAreas;
}

function isConsultationBookNowTask(task: ITask): boolean {
  return String((task as any).bookingKind || '').trim().toLowerCase() === 'consultation';
}

function isPaintingConsultationTask(task: ITask): boolean {
  if (!isConsultationBookNowTask(task)) return false;
  const serviceType = String(task.serviceType || '').trim().toLowerCase();
  const flowType = String((task as any).serviceFlowType || '').trim();
  const slug = String((task as any).categorySlug || '').trim().toLowerCase();
  const subcategory = String(task.subcategory || '').trim().toLowerCase();
  return (
    serviceType === 'painting' ||
    flowType === 'consultation_project' ||
    slug === 'painting' ||
    slug.startsWith('painting-') ||
    subcategory.startsWith('painting-consultation-')
  );
}

async function resolvePaintingConsultationPreferredPartnerUid(
  task: ITask,
): Promise<string | null> {
  if (config.NODE_ENV !== 'development') return null;
  if (!isPaintingConsultationTask(task)) return null;
  const phone = String(config.BOOK_NOW_PAINTING_CONSULTATION_PREFERRED_PHONE || '').trim();
  if (!phone) return null;
  return resolvePartnerUidByPhone(phone);
}

function partnerMatchesWorkArea(workAreas: string[], areaKey: string): boolean {
  const normAreas = workAreas.map((a: string) => normalizeArea(a));
  return normAreas.some(
    (a: string) => a === areaKey || a.includes(areaKey) || areaKey.includes(a),
  );
}

function resolvePartnerDistanceKm(
  taskCoords: { lng: number; lat: number } | null,
  profile: Record<string, unknown>,
): number | null {
  const homeLoc = (profile.homeLocation as { coordinates?: number[] } | undefined)?.coordinates;
  const liveLoc = (profile.location as { coordinates?: number[] } | undefined)?.coordinates;
  const coords =
    Array.isArray(homeLoc) && homeLoc.length === 2 ? homeLoc : liveLoc;
  if (
    !taskCoords ||
    !Array.isArray(coords) ||
    coords.length !== 2 ||
    typeof coords[1] !== 'number' ||
    (coords[0] === 0 && coords[1] === 0)
  ) {
    return null;
  }
  return haversineKm(taskCoords.lat, taskCoords.lng, coords[1], coords[0]);
}

function sortPartnersByDistance(partners: EligiblePartner[]): EligiblePartner[] {
  return [...partners].sort((a, b) => {
    if (a.distKm === null && b.distKm === null) return 0;
    if (a.distKm === null) return 1;
    if (b.distKm === null) return -1;
    return a.distKm - b.distKm;
  });
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
export interface IDispatchCandidateLog {
  partnerId?: string;
  partnerUid?: string;
  name: string;
  status: 'eligible' | 'ineligible' | 'assigned' | 'notified' | 'timed_out' | 'declined';
  reasons?: string[];
  details?: string;
  shiftTiming?: string;
  distanceKm?: number | null;
  notifiedAt?: Date | string | null;
  respondedAt?: Date | string | null;
  dispatchStage?: OfferStage;
  responseStatus?: 'pending' | 'accepted' | 'rejected' | 'timed_out' | 'closed';
  /** Partner's gender as stored in their profile */
  gender?: string | null;
  /** Whether this candidate passed the gender preference check */
  genderCheckResult?: 'passed' | 'failed' | null;
}

export interface IDispatchAreaLog {
  area: string;
  isJobArea?: boolean;
  distanceKm: number;
  matchedCategoryCount: number;
  eligibleCount: number;
  notifiedCount: number;
  acceptedCount?: number;
  rejectedCount?: number;
  timedOutCount?: number;
  assignedCount?: number;
  candidates: IDispatchCandidateLog[];
}

export interface EligiblePartner {
  uid: string;
  profileId: string;
  name: string;
  distKm: number | null;
  workArea: string;
  workAreaDistKm: number;
  gender?: string | null;
  shiftTiming?: string;
}

export interface AutoAssignResult {
  assigned: boolean;
  offered?: boolean;
  partner?: EligiblePartner;
  reason?: string;
  dispatchLogs?: IDispatchAreaLog[];
}

type AutoAssignOptions = {
  /** When set, try this partner before nearest-match dispatch. */
  preferredPartnerUid?: string | null;
  /** Send partner ring notification (default true for new assignments). */
  notifyPartner?: boolean;
};

function normalizePartnerGender(value: unknown): string | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === 'male' || raw === 'man' || raw === 'm') return 'male';
  if (raw === 'female' || raw === 'woman' || raw === 'f') return 'female';
  return raw;
}

function resolvePreferredHelperGender(task: ITask): 'male' | 'female' | null {
  const raw = String((task as { preferredHelperGender?: string }).preferredHelperGender || '')
    .trim()
    .toLowerCase();
  if (raw === 'male' || raw === 'man') return 'male';
  if (raw === 'female' || raw === 'woman') return 'female';
  return null;
}

export function isHourlyTask(task: ITask): boolean {
  const slug = String((task as any).categorySlug || '').trim().toLowerCase();
  const cat = String(task.category || '').trim().toLowerCase();
  const label = String((task as any).categoryLabel || '').trim().toLowerCase();
  const budgetType = String(task.budget?.type || '').trim().toLowerCase();
  const hourlyFlag = Boolean((task as any).hourlyHelper);
  return (
    slug === 'hourly-helper' ||
    slug === 'hourly-based' ||
    cat === 'hourly-helper' ||
    cat === 'hourly-based' ||
    label === 'hourly based' ||
    label === 'hourly helper' ||
    budgetType === 'hourly' ||
    hourlyFlag
  );
}

function partnerMatchesPreferredGender(
  partner: EligiblePartner,
  preferred: 'male' | 'female',
): boolean {
  return normalizePartnerGender(partner.gender) === preferred;
}

/**
 * Soft gender preference: rank matching-gender partners first, then by distance.
 * Never filters out eligible partners — fallback to any eligible by distance.
 */
function sortPartnersByPreferenceThenDistance(
  partners: EligiblePartner[],
  preferredGender: 'male' | 'female' | null,
): EligiblePartner[] {
  const byDistance = sortPartnersByDistance(partners);
  if (!preferredGender) return byDistance;
  const preferred = byDistance.filter((p) =>
    partnerMatchesPreferredGender(p, preferredGender),
  );
  if (preferred.length === 0) return byDistance;
  const others = byDistance.filter(
    (p) => !partnerMatchesPreferredGender(p, preferredGender),
  );
  return [...preferred, ...others];
}

function readPartnerGender(profile: Record<string, unknown>): string | null {
  const pp = (profile.partnerProfile as Record<string, unknown> | undefined) || {};
  return (
    normalizePartnerGender(profile.gender) ||
    normalizePartnerGender(pp.gender) ||
    null
  );
}

export class BookNowAutoAssignService {
  private static async findApplicableAreaRules(task: ITask) {
    const rules = await AssignmentManagementRules.findOne({
      key: 'assignment_management',
    }).lean();
    const taskArea = normalizeArea(
      String(
        task.location?.taskArea ||
          (task.location as any)?.locality ||
          task.location?.city ||
          '',
      ),
    );
    const hourly = isHourlyTask(task);
    const homeCleaning = isHomeCleaningTask(task);

    return (rules?.areaRules || []).filter((rule) => {
      const ruleArea = normalizeArea(rule.area);
      const workTypes = Array.isArray(rule.workTypes) ? rule.workTypes : [];
      const appliesToWorkType =
        workTypes.includes('all') ||
        ((hourly || homeCleaning) && workTypes.includes('hourly')) ||
        (!hourly && workTypes.includes('book_now'));
      return (
        rule.active !== false &&
        appliesToWorkType &&
        Boolean(taskArea) &&
        (ruleArea === taskArea ||
          ruleArea.includes(taskArea) ||
          taskArea.includes(ruleArea))
      );
    });
  }

  static async findEligiblePartners(task: ITask): Promise<EligiblePartner[]> {
    const Profile = mongoose.connection.collection('profiles');
    const profiles = await Profile.find(
      {
        isActive: true,
        isAvailable: { $ne: false },
        'partnerProfile.status': 'approved',
        'partnerProfile.onLeave': { $ne: true },
      },
      {
        projection: {
          _id: 1,
          uid: 1,
          name: 1,
          fullName: 1,
          gender: 1,
          isActive: 1,
          isAvailable: 1,
          helperWorkAreas: 1,
          homeLocation: 1,
          location: 1,
          'partnerProfile.categories': 1,
          'partnerProfile.workAreas': 1,
          'partnerProfile.status': 1,
          'partnerProfile.onLeave': 1,
          'partnerProfile.workShifts': 1,
          'partnerProfile.gender': 1,
        },
      },
    ).toArray() as Record<string, unknown>[];
    const taskCoords =
      Array.isArray(task.location?.coordinates) && task.location.coordinates.length === 2
        ? { lng: task.location.coordinates[0], lat: task.location.coordinates[1] }
        : null;
    const isHourly = isHourlyTask(task);
    const preferredGender = resolvePreferredHelperGender(task);
    const eligible: EligiblePartner[] = [];
    const seenUids = new Set<string>();
    const addPartner = (profile: Record<string, unknown>, workArea: string, workAreaDistKm: number) => {
      const uid = String(profile.uid || '').trim();
      if (!uid || seenUids.has(uid)) return;
      const partnerGender = readPartnerGender(profile);
      const partnerProfile = (profile.partnerProfile as Record<string, unknown>) || {};
      const shifts = Array.isArray(partnerProfile.workShifts)
        ? (partnerProfile.workShifts as string[])
        : [];
      eligible.push({
        uid,
        profileId: String(profile._id),
        name: String(profile.name || profile.fullName || 'Partner'),
        distKm: resolvePartnerDistanceKm(taskCoords, profile),
        workArea,
        workAreaDistKm,
        gender: partnerGender,
        shiftTiming: formatShiftLabel(shifts),
      });
      seenUids.add(uid);
    };

    if (isConsultationBookNowTask(task)) {
      const postedArea = String(
        task.location?.taskArea ||
          (task.location as any)?.locality ||
          task.location?.city ||
          'Consultation area',
      );
      for (const profile of profiles) {
        const partnerProfile = (profile.partnerProfile as Record<string, unknown>) || {};
        const categories = Array.isArray(partnerProfile.categories)
          ? (partnerProfile.categories as string[])
          : [];
        const shifts = Array.isArray(partnerProfile.workShifts)
          ? (partnerProfile.workShifts as string[])
          : [];
        if (
          categories.length &&
          partnerCategoryMatchesBookNowTask(categories, task) &&
          checkTimingMatch(shifts, task) &&
          (!isHourly ||
            !preferredGender ||
            normalizePartnerGender(readPartnerGender(profile)) === preferredGender)
        ) {
          addPartner(profile, postedArea, 0);
        }
      }
      return sortPartnersByDistance(eligible);
    }

    if (isHourly) {
      const location = (task.location || {}) as Record<string, unknown>;
      const candidates = buildHourlyServiceAreaCandidates({
        area: location.taskArea as string | undefined,
        city: location.city as string | undefined,
        state: location.state as string | undefined,
        address: location.address as string | undefined,
      });
      for (const profile of profiles) {
        const matchedArea = matchEligibleHourlyHelperArea(profile, candidates);
        if (!matchedArea) continue;
        const partnerProfile = (profile.partnerProfile as Record<string, unknown>) || {};
        const categories = Array.isArray(partnerProfile.categories)
          ? (partnerProfile.categories as string[])
          : [];
        const shifts = Array.isArray(partnerProfile.workShifts)
          ? (partnerProfile.workShifts as string[])
          : [];
        const partnerGender = readPartnerGender(profile);
        if (
          categories.length &&
          partnerCategoryMatchesBookNowTask(categories, task) &&
          checkTimingMatch(shifts, task) &&
          (!preferredGender || normalizePartnerGender(partnerGender) === preferredGender)
        ) {
          addPartner(profile, matchedArea, 0);
        }
      }
      return sortPartnersByDistance(eligible);
    }

    const orderedWorkAreas = buildOrderedWorkAreasForDispatch(task);
    for (const workArea of orderedWorkAreas) {
      const areaKey = normalizeArea(workArea.area);
      for (const profile of profiles) {
        if (seenUids.has(String(profile.uid || ''))) continue;
        const partnerProfile = (profile.partnerProfile as Record<string, unknown>) || {};
        const categories = Array.isArray(partnerProfile.categories)
          ? (partnerProfile.categories as string[])
          : [];
        const workAreas =
          Array.isArray(partnerProfile.workAreas) && partnerProfile.workAreas.length
            ? (partnerProfile.workAreas as string[])
            : Array.isArray(profile.helperWorkAreas)
              ? (profile.helperWorkAreas as string[])
              : [];
        const shifts = Array.isArray(partnerProfile.workShifts)
          ? (partnerProfile.workShifts as string[])
          : [];
        if (
          categories.length &&
          workAreas.length &&
          partnerCategoryMatchesBookNowTask(categories, task) &&
          partnerMatchesWorkArea(workAreas, areaKey) &&
          checkTimingMatch(shifts, task)
        ) {
          addPartner(profile, workArea.area, workArea.distKm);
        }
      }
    }
    return sortPartnersByPreferenceThenDistance(eligible, preferredGender);
  }

  static mergeEligiblePartnersIntoDispatchLog(
    task: ITask,
    dispatchLogs: IDispatchAreaLog[],
    eligiblePartners: EligiblePartner[],
  ): IDispatchAreaLog[] {
    const mergedLogs = dispatchLogs.map((area) => ({
      ...area,
      candidates: area.candidates.map((candidate) => ({ ...candidate })),
    }));
    const candidateByPartnerId = new Map<string, IDispatchCandidateLog>();
    for (const area of mergedLogs) {
      for (const candidate of area.candidates) {
        if (candidate.partnerUid) candidateByPartnerId.set(candidate.partnerUid, candidate);
        if (candidate.partnerId) candidateByPartnerId.set(candidate.partnerId, candidate);
      }
    }
    const isHourly = isHourlyTask(task);
    const hasGenderPreference = Boolean(resolvePreferredHelperGender(task));

    for (const partner of eligiblePartners) {
      const existing =
        candidateByPartnerId.get(partner.uid) ||
        candidateByPartnerId.get(partner.profileId);
      if (existing) {
        if (existing.status === 'ineligible') {
          existing.status = 'eligible';
          existing.reasons = [];
          existing.details = `Eligible for work in ${partner.workArea}`;
        }
        existing.gender = partner.gender;
        if (isHourly && hasGenderPreference) {
          existing.genderCheckResult = 'passed';
        }
        continue;
      }

      const areaName = partner.workArea || 'Eligible partners';
      let area = mergedLogs.find((item) => item.area === areaName);
      if (!area) {
        area = {
          area: areaName,
          isJobArea: partner.workAreaDistKm === 0,
          distanceKm: partner.workAreaDistKm,
          matchedCategoryCount: 0,
          eligibleCount: 0,
          notifiedCount: 0,
          candidates: [],
        };
        mergedLogs.push(area);
      }

      area.candidates.push({
        partnerId: partner.profileId,
        partnerUid: partner.uid,
        name: partner.name,
        status: 'eligible',
        details: `Eligible for work in ${partner.workArea}`,
        shiftTiming: partner.shiftTiming,
        distanceKm: partner.distKm,
        gender: partner.gender,
        genderCheckResult: isHourly && hasGenderPreference ? 'passed' : null,
        reasons: [],
      });
      const candidate = area.candidates[area.candidates.length - 1];
      candidateByPartnerId.set(partner.uid, candidate);
      candidateByPartnerId.set(partner.profileId, candidate);
    }

    for (const area of mergedLogs) {
      area.matchedCategoryCount = area.candidates.length;
      area.eligibleCount = area.candidates.filter(
        (candidate) =>
          candidate.status === 'eligible' ||
          candidate.status === 'assigned' ||
          candidate.status === 'notified',
      ).length;
      area.notifiedCount = area.candidates.filter(
        (candidate) =>
          Boolean(candidate.notifiedAt) ||
          candidate.status === 'notified' ||
          candidate.status === 'assigned' ||
          candidate.status === 'timed_out',
      ).length;
    }

    return mergedLogs;
  }

  static async assignDispatchStages(
    task: ITask,
    dispatchLogs: IDispatchAreaLog[],
    eligiblePartners: EligiblePartner[],
  ): Promise<IDispatchAreaLog[]> {
    const { tiers, configuredStageByUid } =
      await BookNowAutoAssignService.resolveOfferTiers(task, eligiblePartners);
    const stagedLogs = BookNowAutoAssignService.tagDispatchStages(
      dispatchLogs,
      tiers,
      configuredStageByUid,
    );

    return stagedLogs.map((area, areaIndex) => ({
      ...area,
      candidates: area.candidates.map((candidate, candidateIndex) => ({
        ...candidate,
        dispatchStage:
          dispatchLogs[areaIndex]?.candidates[candidateIndex]?.dispatchStage ||
          candidate.dispatchStage,
      })),
    }));
  }

  private static async resolveOfferTiers(
    task: ITask,
    eligiblePartners: EligiblePartner[],
    preferredPartnerUid?: string,
  ): Promise<{
    tiers: Record<OfferStage, EligiblePartner[]>;
    configuredStageByUid: Map<string, OfferStage>;
  }> {
    const rules = await AssignmentManagementRules.findOne({
      key: 'assignment_management',
    }).lean();
    const eligibleByUid = new Map(eligiblePartners.map((partner) => [partner.uid, partner]));
    const preferredUids = [
      String(preferredPartnerUid || '').trim(),
      ...(rules?.preferredPartners || [])
        .filter((partner) => partner.active !== false)
        .map((partner) => String(partner.uid || '').trim()),
    ].filter((uid, index, uids) => uid && uids.indexOf(uid) === index);

    const areaRules = await BookNowAutoAssignService.findApplicableAreaRules(task);
    const areaRuleUids = areaRules.flatMap((rule) => rule.preferredPartners || [])
      .filter((partner) => partner.active !== false)
      .map((partner) => String(partner.uid || '').trim());
    const allPreferredUids = new Set(preferredUids);
    const allConfiguredUids = new Set([...preferredUids, ...areaRuleUids]);
    const configuredStageByUid = new Map<string, OfferStage>();
    for (const uid of preferredUids) configuredStageByUid.set(uid, 'preferred');
    for (const uid of areaRuleUids) {
      if (!allPreferredUids.has(uid)) configuredStageByUid.set(uid, 'area_rule');
    }

    return {
      tiers: {
        preferred: preferredUids
          .map((uid) => eligibleByUid.get(uid))
          .filter(
            (partner): partner is EligiblePartner =>
              partner !== undefined,
          ),
        area_rule: areaRuleUids
          .filter((uid) => !allPreferredUids.has(uid))
          .map((uid) => eligibleByUid.get(uid))
          .filter(
            (partner): partner is EligiblePartner =>
              partner !== undefined,
          ),
        all: eligiblePartners.filter((partner) => !allConfiguredUids.has(partner.uid)),
      },
      configuredStageByUid,
    };
  }

  private static tagDispatchStages(
    dispatchLogs: IDispatchAreaLog[],
    tiers: Record<OfferStage, EligiblePartner[]>,
    configuredStageByUid: Map<string, OfferStage>,
  ): IDispatchAreaLog[] {
    const stageByUid = new Map(configuredStageByUid);
    for (const stage of OFFER_STAGES) {
      for (const partner of tiers[stage]) stageByUid.set(partner.uid, stage);
    }
    return dispatchLogs.map((area) => ({
      ...area,
      candidates: area.candidates.map((candidate) => ({
        ...candidate,
        ...(!candidate.dispatchStage &&
        candidate.partnerUid &&
        stageByUid.has(candidate.partnerUid)
          ? { dispatchStage: stageByUid.get(candidate.partnerUid) }
          : {}),
        responseStatus: candidate.responseStatus,
      })),
    }));
  }

  private static updateDispatchCandidateResponses(
    dispatchLogs: IDispatchAreaLog[],
    partnerUids: string[],
    responseStatus: 'pending' | 'accepted' | 'rejected' | 'timed_out' | 'closed',
    at: Date,
  ): IDispatchAreaLog[] {
    const uidSet = new Set(partnerUids);
    return dispatchLogs.map((area) => {
      const candidates = area.candidates.map((candidate) => {
        if (!candidate.partnerUid || !uidSet.has(candidate.partnerUid)) return candidate;
        return {
          ...candidate,
          responseStatus,
          ...(responseStatus === 'accepted'
            ? { status: 'assigned' as const, respondedAt: at }
            : responseStatus === 'rejected'
              ? { status: 'declined' as const, respondedAt: at }
              : responseStatus === 'timed_out'
                ? { status: 'timed_out' as const, respondedAt: at }
                : responseStatus === 'closed'
                  ? { respondedAt: at }
                  : {}),
        };
      });
      const uniqueCandidates = new Map(
        candidates.filter((candidate) => candidate.partnerUid).map((candidate) => [candidate.partnerUid!, candidate]),
      );
      return {
        ...area,
        candidates,
        eligibleCount: candidates.filter(
          (candidate) =>
            candidate.status !== 'ineligible' &&
            (candidate.dispatchStage || candidate.status === 'assigned'),
        ).length,
        notifiedCount: new Set(
          candidates
            .filter((candidate) => candidate.notifiedAt)
            .map((candidate) => candidate.partnerUid)
            .filter(Boolean),
        ).size,
        acceptedCount: Array.from(uniqueCandidates.values()).filter(
          (candidate) => candidate.responseStatus === 'accepted',
        ).length,
        rejectedCount: Array.from(uniqueCandidates.values()).filter(
          (candidate) => candidate.responseStatus === 'rejected',
        ).length,
        timedOutCount: Array.from(uniqueCandidates.values()).filter(
          (candidate) => candidate.responseStatus === 'timed_out',
        ).length,
        assignedCount: Array.from(uniqueCandidates.values()).filter(
          (candidate) => candidate.responseStatus === 'accepted',
        ).length,
      };
    });
  }

  private static refreshDispatchProgressCounts(
    progress: NonNullable<ITask['dispatchProgress']> | undefined,
    dispatchLogs: IDispatchAreaLog[],
  ): NonNullable<ITask['dispatchProgress']> | undefined {
    if (!progress) return progress;
    const candidatesByUid = new Map<string, IDispatchCandidateLog>();
    for (const area of dispatchLogs) {
      for (const candidate of area.candidates) {
        if (candidate.partnerUid && candidate.dispatchStage) {
          candidatesByUid.set(candidate.partnerUid, candidate);
        }
      }
    }
    return {
      ...progress,
      stages: progress.stages.map((stageProgress) => {
        const candidates = Array.from(candidatesByUid.values()).filter(
          (candidate) => candidate.dispatchStage === stageProgress.stage,
        );
        return {
          ...stageProgress,
          eligibleCount: candidates.filter((candidate) => candidate.status !== 'ineligible').length,
          notifiedCount: candidates.filter((candidate) => Boolean(candidate.notifiedAt)).length,
          acceptedCount: candidates.filter((candidate) => candidate.responseStatus === 'accepted').length,
          rejectedCount: candidates.filter((candidate) => candidate.responseStatus === 'rejected').length,
          timedOutCount: candidates.filter((candidate) => candidate.responseStatus === 'timed_out').length,
        };
      }),
    };
  }

  private static buildDispatchProgress(
    dispatchLogs: IDispatchAreaLog[],
    previous: ITask['dispatchProgress'],
    currentStage: DispatchCurrentStage,
    now: Date,
    expiresAt?: Date,
  ): NonNullable<ITask['dispatchProgress']> {
    const candidateByUid = new Map<string, IDispatchCandidateLog>();
    for (const area of dispatchLogs) {
      for (const candidate of area.candidates) {
        if (candidate.partnerUid && candidate.dispatchStage) {
          candidateByUid.set(candidate.partnerUid, candidate);
        }
      }
    }
    const stages = OFFER_STAGES.map((stage) => {
      const candidates = Array.from(candidateByUid.values()).filter(
        (candidate) => candidate.dispatchStage === stage,
      );
      const eligibleCount = candidates.filter(
        (candidate) => candidate.status !== 'ineligible',
      ).length;
      const prior = previous?.stages.find((item) => item.stage === stage);
      const isCurrentStage = stage === currentStage;
      const isAssigned = currentStage === 'assigned';
      const isClosed = currentStage === 'closed';
      const status: 'pending' | 'in_progress' | 'completed' | 'skipped' =
        isAssigned || isClosed
          ? prior?.status === 'completed'
            ? 'completed'
            : 'skipped'
          : isCurrentStage
            ? 'in_progress'
            : prior?.status === 'completed'
              ? 'completed'
              : eligibleCount > 0
                ? 'pending'
                : 'skipped';
      return {
        stage,
        status,
        eligibleCount,
        notifiedCount: candidates.filter((candidate) => candidate.notifiedAt).length,
        acceptedCount: candidates.filter(
          (candidate) => candidate.responseStatus === 'accepted',
        ).length,
        rejectedCount: candidates.filter(
          (candidate) => candidate.responseStatus === 'rejected',
        ).length,
        timedOutCount: candidates.filter(
          (candidate) => candidate.responseStatus === 'timed_out',
        ).length,
        startedAt: isCurrentStage ? now : prior?.startedAt,
        expiresAt: isCurrentStage ? expiresAt : prior?.expiresAt,
        completedAt:
          isAssigned || isClosed ? prior?.completedAt || now : prior?.completedAt,
      };
    });
    return {
      currentStage,
      startedAt: previous?.startedAt || now,
      acceptanceWindowMinutes: 30,
      stages,
      assignedPartnerName: previous?.assignedPartnerName,
      assignedPartnerUid: previous?.assignedPartnerUid,
      assignedAt: previous?.assignedAt,
      supportEscalation: previous?.supportEscalation || {
        status: 'pending',
        dueAt: new Date(now.getTime() + SUPPORT_ESCALATION_MS),
      },
    };
  }

  private static async sendOfferNotification(
    task: ITask,
    stage: OfferStage,
    recipientUids: string[],
    expiresAt: Date,
  ): Promise<string[]> {
    if (!recipientUids.length) return [];
    return NotificationClient.sendWithDeliveryResults({
      eventKey: 'TASK_UPDATED',
      category: 'taskUpdates',
      recipients: recipientUids,
      entity: { type: 'task', id: String(task._id) },
      title: 'New Book Now work offer',
      body: `${task.title || 'A new work'} is available. Accept or reject within 30 minutes.`,
      data: {
        taskId: String(task._id),
        title: task.title,
        category: task.category,
        categoryLabel: (task as any).categoryLabel || task.category,
        bookingSource: 'book_now',
        bookNowOffer: true,
        action: 'book_now_offer',
        recipientRole: 'partner',
        offerStage: stage,
        offerExpiresAt: expiresAt.toISOString(),
        amount:
          typeof task.budget === 'object' && task.budget
            ? Number(task.budget.amount || 0)
            : 0,
        taskArea:
          task.location?.taskArea ||
          (task.location as any)?.locality ||
          task.location?.city ||
          '',
      },
    });
  }

  private static async recordOfferNotifications(
    taskId: mongoose.Types.ObjectId,
    stage: OfferStage,
    deliveredUids: string[],
    notifiedAt: Date,
  ): Promise<void> {
    if (!deliveredUids.length) return;
    await Task.updateOne(
      {
        _id: taskId,
        'dispatchLogs.candidates': {
          $elemMatch: {
            partnerUid: { $in: deliveredUids },
            notifiedAt: null,
          },
        },
      },
      {
        $set: {
          'dispatchLogs.$[area].candidates.$[candidate].notifiedAt': notifiedAt,
        },
        $inc: {
          'dispatchProgress.stages.$[progressStage].notifiedCount': deliveredUids.length,
        },
      },
      {
        arrayFilters: [
          { 'area.candidates.partnerUid': { $in: deliveredUids } },
          {
            'candidate.partnerUid': { $in: deliveredUids },
            'candidate.notifiedAt': null,
          },
          { 'progressStage.stage': stage },
        ],
      },
    );
    await Task.updateOne(
      { _id: taskId, 'assignmentOffer.stage': stage },
      { $addToSet: { 'assignmentOffer.notifiedPartnerUids': { $each: deliveredUids } } },
    );
  }

  private static async installOfferStage(
    taskId: mongoose.Types.ObjectId,
    task: ITask,
    stage: OfferStage,
    recipients: EligiblePartner[],
    previouslyNotifiedUids: string[],
    rejectedPartnerUids: string[],
    expectedStage?: OfferStage | 'closed',
    expectedExpiresAt?: Date,
    completedStageUids: string[] = [],
    completedStageResponseStatus: 'timed_out' | 'closed' = 'timed_out',
    notificationRecipients?: EligiblePartner[],
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OFFER_WINDOW_MS);
    const recipientUids = recipients.map((partner) => partner.uid);
    const notificationRecipientUids = (notificationRecipients || recipients).map(
      (partner) => partner.uid,
    );
    const notifiedPartnerUids = [...new Set(previouslyNotifiedUids)];
    let dispatchLogs = BookNowAutoAssignService.updateDispatchCandidateResponses(
      task.dispatchLogs || [],
      completedStageUids,
      completedStageResponseStatus,
      now,
    );
    dispatchLogs = BookNowAutoAssignService.updateDispatchCandidateResponses(
      dispatchLogs,
      recipientUids,
      'pending',
      now,
    );
    const dispatchProgress = BookNowAutoAssignService.buildDispatchProgress(
      dispatchLogs,
      task.dispatchProgress,
      stage,
      now,
      expiresAt,
    );
    for (const progressStage of dispatchProgress.stages) {
      if (progressStage.stage === stage) continue;
      if (OFFER_STAGES.indexOf(progressStage.stage) < OFFER_STAGES.indexOf(stage)) {
        if (progressStage.eligibleCount > 0) {
          progressStage.status = 'completed';
          progressStage.completedAt ||= now;
        }
      } else if (
        progressStage.eligibleCount === 0 ||
        OFFER_STAGES.indexOf(progressStage.stage) > OFFER_STAGES.indexOf(stage)
      ) {
        progressStage.status = 'skipped';
        progressStage.completedAt ||= now;
      }
    }
    const updatedProgress =
      BookNowAutoAssignService.refreshDispatchProgressCounts(dispatchProgress, dispatchLogs) ||
      dispatchProgress;
    const filter: Record<string, unknown> = {
      _id: taskId,
      status: 'open',
      assigneeUid: null,
      partnerUid: null,
    };
    if (expectedStage && expectedExpiresAt) {
      filter['assignmentOffer.stage'] = expectedStage;
      filter['assignmentOffer.expiresAt'] = expectedExpiresAt;
    } else {
      filter.$or = [
        { assignmentOffer: { $exists: false } },
        { assignmentOffer: null },
      ];
    }

    const updated = await Task.findOneAndUpdate(
      filter,
      {
        $set: {
          assignmentStatus: 'pending',
          dispatchLogs,
          dispatchProgress: updatedProgress,
          assignmentOffer: {
            stage,
            recipientUids,
            notifiedPartnerUids,
            rejectedPartnerUids,
            notifiedAt: now,
            expiresAt,
          },
        },
      },
      { new: true },
    );
    if (!updated) return false;
    const deliveredUids = await BookNowAutoAssignService.sendOfferNotification(
      task,
      stage,
      notificationRecipientUids,
      expiresAt,
    );
    if (deliveredUids.length) {
      await BookNowAutoAssignService.recordOfferNotifications(
        taskId,
        stage,
        deliveredUids,
        now,
      );
    }
    const failedRecipientCount = notificationRecipientUids.length - deliveredUids.length;
    if (failedRecipientCount > 0) {
      logger.warn('[BookNowAutoAssign] Partner offer notification handoff failed', {
        taskId: String(taskId),
        stage,
        recipientCount: failedRecipientCount,
      });
    }
    logger.info('[BookNowAutoAssign] Partner offer wave sent', {
      taskId: String(taskId),
      stage,
      recipientCount: notificationRecipientUids.length,
      recipientUids: notificationRecipientUids,
      expiresAt,
    });
    return true;
  }

  private static async startOfferFlow(
    task: ITask,
    preferredPartnerUid?: string,
  ): Promise<AutoAssignResult> {
    const taskId = new mongoose.Types.ObjectId(String(task._id));
    const existing = await Task.findById(taskId).select('assignmentOffer status').lean();
    if (existing?.assignmentOffer) {
      if (existing.assignmentOffer.stage === 'closed') {
        return {
          assigned: false,
          reason: 'All partner offer tiers expired without acceptance',
        };
      }
      return {
        assigned: false,
        offered: true,
        reason: 'Partner offers are already active',
      };
    }

    const eligiblePartners = await BookNowAutoAssignService.findEligiblePartners(task);
    const baseDispatchLogs = BookNowAutoAssignService.mergeEligiblePartnersIntoDispatchLog(
      task,
      await BookNowAutoAssignService.buildDispatchLog(task),
      eligiblePartners,
    );
    const tierResolution = await BookNowAutoAssignService.resolveOfferTiers(
      task,
      eligiblePartners,
      preferredPartnerUid,
    );
    const { tiers, configuredStageByUid } = tierResolution;
    const dispatchLogs = BookNowAutoAssignService.tagDispatchStages(
      baseDispatchLogs,
      tiers,
      configuredStageByUid,
    );
    const firstStage = OFFER_STAGES.find((stage) => tiers[stage].length > 0);
    const dispatchStartedAt = new Date();
    const dispatchProgress = BookNowAutoAssignService.buildDispatchProgress(
      dispatchLogs,
      undefined,
      firstStage || 'closed',
      dispatchStartedAt,
    );
    const taskWithDispatch = { ...task, dispatchLogs, dispatchProgress } as ITask;
    await Task.updateOne(
      {
        _id: taskId,
        status: 'open',
        assigneeUid: null,
        partnerUid: null,
        $or: [
          { assignmentOffer: { $exists: false } },
          { assignmentOffer: null },
        ],
      },
      { $set: { dispatchLogs, dispatchProgress } },
    );

    for (const stage of OFFER_STAGES) {
      const recipients = tiers[stage];
      if (!recipients.length) continue;
      const installed = await BookNowAutoAssignService.installOfferStage(
        taskId,
        taskWithDispatch,
        stage,
        recipients,
        [],
        [],
      );
      if (!installed) {
        const latest = await Task.findById(taskId).select('status assignmentOffer').lean();
        if (latest?.assignmentOffer) {
          return { assigned: false, offered: true, dispatchLogs };
        }
        return {
          assigned: false,
          reason: 'Task is no longer available for partner offers',
          dispatchLogs,
        };
      }
      return {
        assigned: false,
        offered: true,
        reason: `Offers sent to ${stage === 'area_rule' ? 'area-rule' : stage} partners`,
        dispatchLogs,
      };
    }

    const closedAt = new Date();
    await Task.updateOne(
      {
        _id: taskId,
        status: 'open',
        assigneeUid: null,
        partnerUid: null,
        $or: [
          { assignmentOffer: { $exists: false } },
          { assignmentOffer: null },
        ],
      },
      {
        $set: {
          assignmentStatus: 'pending',
          assignmentOffer: {
            stage: 'closed',
            recipientUids: [],
            notifiedPartnerUids: [],
            rejectedPartnerUids: [],
            notifiedAt: closedAt,
            expiresAt: closedAt,
          },
          dispatchProgress: BookNowAutoAssignService.buildDispatchProgress(
            dispatchLogs,
            dispatchProgress,
            'closed',
            closedAt,
          ),
        },
      },
    );
    logger.warn('[BookNowAutoAssign] No eligible partners found for offer flow', {
      taskId: String(taskId),
    });
    return {
      assigned: false,
      reason: 'No eligible approved partner found for the work area and schedule',
      dispatchLogs,
    };
  }

  static async dispatchBookNowOffers(
    task: ITask,
    preferredPartnerUid?: string,
  ): Promise<AutoAssignResult> {
    if (task.bookingSource !== 'book_now') {
      return { assigned: false, reason: 'Partner offer dispatch is only for Book Now work' };
    }
    if (task.status !== 'open') {
      return { assigned: false, reason: 'Work is not open for partner offers' };
    }
    if (task.assigneeId || task.assigneeUid || task.partnerId || task.partnerUid) {
      return { assigned: false, reason: 'Work already has an assigned partner' };
    }

    return BookNowAutoAssignService.startOfferFlow(task, preferredPartnerUid);
  }

  static async advanceOfferStage(taskIdValue: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(taskIdValue)) return false;
    const taskId = new mongoose.Types.ObjectId(taskIdValue);
    const task = await Task.findById(taskId).lean() as ITask | null;
    if (!task || task.status !== 'open' || !task.assignmentOffer) return false;
    const currentOffer = task.assignmentOffer;
    const expiredStage = currentOffer.stage;
    if (expiredStage === 'closed') return false;
    const now = new Date();
    if (currentOffer.expiresAt > now) return false;

    const eligiblePartners = await BookNowAutoAssignService.findEligiblePartners(task);
    const { tiers } = await BookNowAutoAssignService.resolveOfferTiers(task, eligiblePartners);
    const currentStageIndex = OFFER_STAGES.indexOf(expiredStage);
    for (let index = currentStageIndex + 1; index < OFFER_STAGES.length; index += 1) {
      const stage = OFFER_STAGES[index];
      const notified = new Set(currentOffer.notifiedPartnerUids || []);
      const recipients = tiers[stage].filter(
        (partner) => !notified.has(partner.uid),
      );
      if (!recipients.length) continue;
      const advanced = await BookNowAutoAssignService.installOfferStage(
        taskId,
        task,
        stage,
        recipients,
        currentOffer.notifiedPartnerUids || [],
        currentOffer.rejectedPartnerUids || [],
        expiredStage,
        currentOffer.expiresAt,
        currentOffer.recipientUids || [],
      );
      return advanced;
    }

    const dispatchLogs = BookNowAutoAssignService.updateDispatchCandidateResponses(
      task.dispatchLogs || [],
      currentOffer.recipientUids || [],
      'timed_out',
      now,
    );
    const dispatchProgress = BookNowAutoAssignService.refreshDispatchProgressCounts(
      task.dispatchProgress,
      dispatchLogs,
    );
    if (dispatchProgress) {
      dispatchProgress.currentStage = 'closed';
      dispatchProgress.stages = dispatchProgress.stages.map((stageProgress) => {
        const stageIndex = OFFER_STAGES.indexOf(stageProgress.stage);
        const currentStageIndex = OFFER_STAGES.indexOf(expiredStage);
        const status =
          stageProgress.stage === expiredStage
            ? 'completed'
            : stageIndex < currentStageIndex && stageProgress.eligibleCount > 0
              ? 'completed'
              : 'skipped';
        return {
          ...stageProgress,
          status,
          completedAt: stageProgress.completedAt || now,
        };
      });
    }
    const closed = await Task.updateOne(
      {
        _id: taskId,
        status: 'open',
        'assignmentOffer.stage': expiredStage,
        'assignmentOffer.expiresAt': currentOffer.expiresAt,
      },
      {
        $set: {
          'assignmentOffer.stage': 'closed',
          'assignmentOffer.recipientUids': [],
          dispatchLogs,
          ...(dispatchProgress ? { dispatchProgress } : {}),
        },
      },
    );
    if (closed.modifiedCount > 0) {
      logger.warn('[BookNowAutoAssign] All partner offer tiers expired without acceptance', {
        taskId: String(taskId),
        notifiedPartnerCount: currentOffer.notifiedPartnerUids.length,
      });
    }
    return closed.modifiedCount > 0;
  }

  static async notifyOfferStageImmediately(
    taskIdValue: string,
    stage: Exclude<OfferStage, 'preferred'>,
  ): Promise<{ stage: Exclude<OfferStage, 'preferred'>; notifiedCount: number }> {
    if (!mongoose.Types.ObjectId.isValid(taskIdValue)) {
      throw new BadRequestError('A valid task is required');
    }
    const taskId = new mongoose.Types.ObjectId(taskIdValue);
    const task = await Task.findById(taskId).lean() as ITask | null;
    if (
      !task ||
      task.bookingSource !== 'book_now' ||
      task.status !== 'open' ||
      task.assigneeId ||
      task.assigneeUid ||
      task.partnerId ||
      task.partnerUid
    ) {
      throw new BadRequestError('Only open, unassigned Book Now work can be notified');
    }

    const eligiblePartners = await BookNowAutoAssignService.findEligiblePartners(task);
    const { tiers, configuredStageByUid } =
      await BookNowAutoAssignService.resolveOfferTiers(task, eligiblePartners);
    const dispatchLogs = BookNowAutoAssignService.tagDispatchStages(
      BookNowAutoAssignService.mergeEligiblePartnersIntoDispatchLog(
        task,
        await BookNowAutoAssignService.buildDispatchLog(task),
        eligiblePartners,
      ),
      tiers,
      configuredStageByUid,
    );
    const alreadyNotifiedUids = new Set(
      dispatchLogs.flatMap((area) =>
        area.candidates
          .filter((candidate) => candidate.notifiedAt)
          .map((candidate) => candidate.partnerUid)
          .filter((uid): uid is string => Boolean(uid)),
      ),
    );
    const newlyNotifiedRecipients = tiers[stage].filter(
      (partner) => !alreadyNotifiedUids.has(partner.uid),
    );
    if (!newlyNotifiedRecipients.length) {
      throw new BadRequestError(`No unnotified eligible partners are available in the ${stage} stage`);
    }

    const currentOffer = task.assignmentOffer;
    const activeRecipientUids =
      currentOffer && currentOffer.stage !== 'closed'
        ? currentOffer.recipientUids || []
        : [];
    const activePendingUids = activeRecipientUids.filter((uid) => {
      const candidate = dispatchLogs
        .flatMap((area) => area.candidates)
        .find((item) => item.partnerUid === uid);
      return candidate?.responseStatus === undefined || candidate.responseStatus === 'pending';
    });
    const continuingCurrentStage =
      currentOffer?.stage === stage
        ? tiers[stage].filter((partner) => activePendingUids.includes(partner.uid))
        : [];
    const recipients = [
      ...continuingCurrentStage,
      ...newlyNotifiedRecipients.filter(
        (partner) => !continuingCurrentStage.some((current) => current.uid === partner.uid),
      ),
    ];
    const retainedRecipientUids = new Set(recipients.map((partner) => partner.uid));
    const recipientsToClose = activePendingUids.filter(
      (uid) => !retainedRecipientUids.has(uid),
    );
    const previouslyNotifiedUids = Array.from(
      new Set([
        ...(currentOffer?.notifiedPartnerUids || []),
        ...Array.from(alreadyNotifiedUids),
      ]),
    );
    const rejectedPartnerUids = currentOffer?.rejectedPartnerUids || [];
    const installed = await BookNowAutoAssignService.installOfferStage(
      taskId,
      { ...task, dispatchLogs } as ITask,
      stage,
      recipients,
      previouslyNotifiedUids,
      rejectedPartnerUids,
      currentOffer?.stage,
      currentOffer?.expiresAt,
      recipientsToClose,
      'closed',
      newlyNotifiedRecipients,
    );
    if (!installed) {
      throw new BadRequestError('The work changed before notifications could be sent. Refresh and try again.');
    }

    const recipientUids = new Set(recipients.map((partner) => partner.uid));
    const updatedTask = await Task.findById(taskId).select('dispatchLogs').lean();
    const notifiedCount = (updatedTask?.dispatchLogs || []).reduce(
      (count, area) =>
        count +
        area.candidates.filter(
          (candidate) =>
            candidate.dispatchStage === stage &&
            candidate.partnerUid &&
            recipientUids.has(candidate.partnerUid) &&
            candidate.notifiedAt,
        ).length,
      0,
    );
    return { stage, notifiedCount };
  }

  static async retryUnnotifiedOffers(taskIdValue: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(taskIdValue)) return false;
    const taskId = new mongoose.Types.ObjectId(taskIdValue);
    const task = await Task.findById(taskId).lean() as ITask | null;
    if (!task || task.status !== 'open' || !task.assignmentOffer) return false;

    const offer = task.assignmentOffer;
    if (
      offer.stage === 'closed' ||
      offer.expiresAt <= new Date() ||
      !offer.recipientUids?.length
    ) {
      return false;
    }

    const notifiedUids = new Set(
      (task.dispatchLogs || []).flatMap((area) =>
        area.candidates
          .filter((candidate) => candidate.notifiedAt)
          .map((candidate) => candidate.partnerUid)
          .filter((uid): uid is string => Boolean(uid)),
      ),
    );
    const recipientUids = offer.recipientUids.filter((uid) => !notifiedUids.has(uid));
    if (!recipientUids.length) return false;

    const stage = offer.stage;
    const expiresAt = offer.expiresAt;
    const deliveredUids = await BookNowAutoAssignService.sendOfferNotification(
      task,
      stage,
      recipientUids,
      expiresAt,
    );
    if (!deliveredUids.length) return false;

    await BookNowAutoAssignService.recordOfferNotifications(
      taskId,
      stage,
      deliveredUids,
      new Date(),
    );
    logger.info('[BookNowAutoAssign] Retried unconfirmed partner offer notification', {
      taskId: String(taskId),
      stage,
      recipientCount: deliveredUids.length,
    });
    return true;
  }

  static async respondToOffer(
    taskIdValue: string,
    partnerUidValue: string,
    action: 'accept' | 'reject',
  ): Promise<void> {
    const taskId = String(taskIdValue || '').trim();
    const partnerUid = String(partnerUidValue || '').trim();
    if (!mongoose.Types.ObjectId.isValid(taskId) || !partnerUid) {
      throw new BadRequestError('A valid task and partner are required');
    }
    if (action === 'reject') {
      const now = new Date();
      const offerFilter = {
        _id: taskId,
        bookingSource: 'book_now',
        status: 'open',
        'assignmentOffer.recipientUids': partnerUid,
        'assignmentOffer.expiresAt': { $gt: now },
      };
      const task = await Task.findOne(offerFilter).lean() as ITask | null;
      if (!task?.assignmentOffer) {
        throw new ForbiddenError('This work offer is no longer available to you');
      }
      const dispatchLogs = BookNowAutoAssignService.updateDispatchCandidateResponses(
        task.dispatchLogs || [],
        [partnerUid],
        'rejected',
        now,
      );
      const dispatchProgress = BookNowAutoAssignService.refreshDispatchProgressCounts(
        task.dispatchProgress,
        dispatchLogs,
      );
      const update = await Task.updateOne(
        offerFilter,
        {
          $set: {
            dispatchLogs,
            ...(dispatchProgress ? { dispatchProgress } : {}),
          },
          $pull: { 'assignmentOffer.recipientUids': partnerUid },
          $addToSet: { 'assignmentOffer.rejectedPartnerUids': partnerUid },
        },
      );
      if (update.matchedCount === 0) {
        throw new ForbiddenError('This work offer is no longer available to you');
      }
      return;
    }

    const task = await Task.findOne({
      _id: taskId,
      bookingSource: 'book_now',
      status: 'open',
      'assignmentOffer.recipientUids': partnerUid,
      'assignmentOffer.expiresAt': { $gt: new Date() },
    }).lean() as ITask | null;
    if (!task?.assignmentOffer) {
      throw new ForbiddenError('This work offer is no longer available to you');
    }
    const partner = await BookNowAutoAssignService.findPreferredPartnerForTask(
      task,
      partnerUid,
    );
    if (!partner) {
      await BookNowAutoAssignService.respondToOffer(taskId, partnerUid, 'reject');
      throw new ForbiddenError('You are no longer eligible for this work');
    }

    const now = new Date();
    const previousOffer = task.assignmentOffer;
    let dispatchLogs = task.dispatchLogs || await BookNowAutoAssignService.buildDispatchLog(task);
    dispatchLogs = BookNowAutoAssignService.updateDispatchCandidateResponses(
      dispatchLogs,
      [partnerUid],
      'accepted',
      now,
    );
    dispatchLogs = BookNowAutoAssignService.updateDispatchCandidateResponses(
      dispatchLogs,
      (previousOffer.recipientUids || []).filter((uid) => uid !== partnerUid),
      'closed',
      now,
    );
    const dispatchProgress = BookNowAutoAssignService.refreshDispatchProgressCounts(
      task.dispatchProgress,
      dispatchLogs,
    );
    if (dispatchProgress) {
      const acceptedStageIndex = OFFER_STAGES.indexOf(previousOffer.stage as OfferStage);
      dispatchProgress.currentStage = 'assigned';
      dispatchProgress.assignedPartnerName = partner.name;
      dispatchProgress.assignedPartnerUid = partnerUid;
      dispatchProgress.assignedAt = now;
      const escalationAlreadyDue =
        dispatchProgress.supportEscalation.status === 'pending' &&
        dispatchProgress.supportEscalation.dueAt.getTime() <= now.getTime();
      dispatchProgress.supportEscalation = {
        ...dispatchProgress.supportEscalation,
        status: escalationAlreadyDue
          ? 'escalated'
          : dispatchProgress.supportEscalation.status === 'escalated'
            ? 'escalated'
            : 'stopped',
        ...(escalationAlreadyDue
          ? { escalatedAt: now }
          : {}),
      };
      dispatchProgress.stages = dispatchProgress.stages.map((stageProgress) => {
        const stageIndex = OFFER_STAGES.indexOf(stageProgress.stage);
        const wasStarted = Boolean(stageProgress.startedAt || stageProgress.notifiedCount);
        const status =
          stageProgress.stage === previousOffer.stage
            ? 'completed'
            : stageIndex < acceptedStageIndex && wasStarted
              ? 'completed'
              : stageIndex > acceptedStageIndex
                ? 'skipped'
                : stageProgress.eligibleCount === 0
                  ? 'skipped'
                  : stageProgress.status;
        return {
          ...stageProgress,
          status,
          completedAt: status === 'completed' || status === 'skipped'
            ? stageProgress.completedAt || now
            : stageProgress.completedAt,
        };
      });
    }
    const partnerProfileId = new mongoose.Types.ObjectId(partner.profileId);
    const claimedTask = await Task.findOneAndUpdate(
      {
        _id: task._id,
        bookingSource: 'book_now',
        status: 'open',
        assigneeUid: null,
        partnerUid: null,
        'assignmentOffer.recipientUids': partnerUid,
        'assignmentOffer.expiresAt': { $gt: now },
      },
      {
        $set: {
          assigneeId: partnerProfileId,
          assigneeUid: partnerUid,
          assigneeName: partner.name,
          assignedHelperName: partner.name,
          assignedToName: partner.name,
          partnerId: partnerProfileId,
          partnerUid,
          partnerAcceptedAt: now,
          assignedAt: now,
          status: 'assigned',
          assignmentStatus: 'assigned',
          confirmed: true,
          confirmedAt: now,
          confirmed_at: now,
          dispatchLogs,
          ...(dispatchProgress ? { dispatchProgress } : {}),
        },
        $unset: { assignmentOffer: '' },
      },
      { new: true },
    );
    if (!claimedTask) {
      throw new ForbiddenError('Another partner has already accepted this work');
    }

    let assignmentId: mongoose.Types.ObjectId | undefined;
    try {
      await Assignment.updateMany(
        { taskId: task._id, status: { $in: ['assigned', 'pending'] } },
        { $set: { status: 'cancelled' } },
      );
      const assignment = await Assignment.create({
        bookingOrderId: task.bookingOrderId || 'auto',
        bookingItemId:
          task.bookingItemId && mongoose.Types.ObjectId.isValid(task.bookingItemId)
            ? new mongoose.Types.ObjectId(task.bookingItemId)
            : task._id,
        taskId: task._id,
        helperUid: partner.uid,
        helperProfileId: partnerProfileId,
        assignmentMode: 'auto',
        status: 'assigned',
        assignedByUid: 'partner_offer',
        assignedAt: now,
      });
      assignmentId = assignment._id;
      await AssignmentLog.create({
        assignmentId: assignment._id,
        action: 'partner_accepted_book_now_offer',
        actorUid: partner.uid,
        metadata: {
          partnerUid: partner.uid,
          partnerProfileId: partner.profileId,
          offerStage: previousOffer.stage,
        },
      });
    } catch (error) {
      if (assignmentId) {
        await Assignment.updateOne(
          { _id: assignmentId },
          { $set: { status: 'cancelled' } },
        );
      }
      await Task.updateOne(
        { _id: task._id, status: 'assigned', assigneeUid: partnerUid },
        {
          $set: {
            status: 'open',
            assignmentStatus: 'pending',
            assignmentOffer: previousOffer,
            assigneeId: null,
            assigneeUid: null,
            assigneeName: null,
            assignedHelperName: null,
            assignedToName: null,
            partnerId: null,
            partnerUid: null,
            confirmed: false,
            confirmedAt: null,
            confirmed_at: null,
            dispatchLogs: task.dispatchLogs || [],
            ...(task.dispatchProgress ? { dispatchProgress: task.dispatchProgress } : {}),
          },
          $unset: { assignedAt: '', partnerAcceptedAt: '' },
        },
      );
      throw error;
    }

    void notifyBookNowAssignment({
      actorUid: 'system',
      taskId: String(task._id),
      taskTitle: String(task.title || 'your booking'),
      customerUid: String((task as any).requesterUid || '').trim() || undefined,
      customerProfileId: task.requesterId,
      helperUid: partner.uid,
      helperName: partner.name,
      notifyPartner: false,
      notifyCustomer: true,
      recipientRole: 'partner',
    }).catch((error: unknown) => {
      logger.warn('[BookNowAutoAssign] Customer assignment notification failed', {
        taskId: String(task._id),
        error: error instanceof Error ? error.message : String(error),
      });
    });

    await BookNowAutoAssignService.onPartnerAccepted(task, partner);
  }

  private static async onPartnerAccepted(
    task: ITask,
    partner: EligiblePartner,
  ): Promise<void> {
    const orderId = String(task.bookingOrderId || '').trim();
    if (!orderId) return;
    try {
      const order = await BookingOrder.findOne({ orderId });
      if (!order) return;
      if (order.paymentEscrowId) {
        const attached = await PaymentClient.attachPerformerToEscrow({
          escrowId: order.paymentEscrowId,
          performerUid: partner.uid,
        });
        if (!attached.success) {
          logger.warn('[BookNowAutoAssign] Escrow performer attach failed', {
            orderId,
            taskId: String(task._id),
            partnerUid: partner.uid,
            error: attached.error,
          });
        }
      }

      const items = await BookingItem.find({
        orderId,
        status: { $ne: 'cancelled' },
      })
        .select('taskId')
        .lean();
      const taskIds = items.map((item) => item.taskId).filter(Boolean);
      const orderTasks = taskIds.length
        ? await Task.find({ _id: { $in: taskIds } })
            .select('assigneeUid status')
            .lean()
        : [];
      if (
        orderTasks.length > 0 &&
        orderTasks.every((item) => Boolean(item.assigneeUid))
      ) {
        await BookingOrder.updateOne(
          { orderId, status: { $in: ['assigning', 'paid'] } },
          { $set: { status: 'assigned' } },
        );
      }
    } catch (error) {
      logger.error('[BookNowAutoAssign] Post-accept booking update failed', {
        orderId,
        taskId: String(task._id),
        partnerUid: partner.uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Build comprehensive dispatch evaluation logs for a Book Now task.
   * Checks the job area + nearby areas (<= 5km), evaluating all candidates against
   * category matching, shift window overlap, leave/availability, distance, and assignment status.
   */
  static async buildDispatchLog(task: ITask, assignedPartnerUid?: string): Promise<IDispatchAreaLog[]> {
    const Profile = mongoose.connection.collection('profiles');
     const profiles = await Profile.find(
       {
         $or: [
           { 'partnerProfile.workAreas.0': { $exists: true } },
           { 'helperWorkAreas.0': { $exists: true } },
         ],
       },
       {
         projection: {
           _id: 1,
           uid: 1,
           name: 1,
           fullName: 1,
           gender: 1,
           isActive: 1,
           isAvailable: 1,
           helperWorkAreas: 1,
           homeLocation: 1,
           location: 1,
           'partnerProfile.categories': 1,
           'partnerProfile.workAreas': 1,
           'partnerProfile.status': 1,
           'partnerProfile.onLeave': 1,
           'partnerProfile.workShifts': 1,
           'partnerProfile.gender': 1,
         },
       },
     ).toArray();

    const taskCoords =
      Array.isArray(task.location?.coordinates) && task.location.coordinates.length === 2
        ? { lng: task.location.coordinates[0], lat: task.location.coordinates[1] }
        : null;

    const postedArea =
      task.location?.taskArea ||
      (task.location as any)?.locality ||
      task.location?.city ||
      'Yapral';

    const taskTimeString = formatTaskTimeDisplay(task);
    const parentCategory = extractParentCategory(task);

    logger.debug('[BookNowAutoAssign] Dispatch evaluation', {
      taskId: String(task._id),
      parentCategory,
      postedArea,
    });

    const orderedWorkAreas = buildOrderedWorkAreasForDispatch(task);

    const assignedUid =
      assignedPartnerUid ||
      task.assigneeUid ||
      task.partnerUid ||
      (task.partnerId ? String(task.partnerId) : undefined);

    const isHourly = isHourlyTask(task);
    const preferredGender = resolvePreferredHelperGender(task);

    const dispatchAreaLogs: IDispatchAreaLog[] = [];

    // 2. Evaluate each area
    for (const wa of orderedWorkAreas) {
      const areaKey = normalizeArea(wa.area);
      const isJobArea = wa.distKm === 0.0;
      const candidates: IDispatchCandidateLog[] = [];

      // Find real matching profiles in DB
      for (const p of profiles) {
        const pp = (p.partnerProfile as any) || {};
        const categories: string[] = Array.isArray(pp.categories) ? pp.categories : [];
        const workAreas: string[] =
          isHourly && Array.isArray(p.helperWorkAreas) && (!Array.isArray(pp.workAreas) || pp.workAreas.length === 0)
            ? (p.helperWorkAreas as string[])
            : Array.isArray(pp.workAreas)
            ? pp.workAreas
            : Array.isArray(p.helperWorkAreas)
            ? (p.helperWorkAreas as string[])
            : [];

        if (!workAreas.length) continue;
        const normAreas = workAreas.map((a: string) => normalizeArea(a));
        const areaMatches = normAreas.some((a: string) => a === areaKey || a.includes(areaKey) || areaKey.includes(a));
        if (!areaMatches) continue;

        const categoryMatches = partnerCategoryMatchesBookNowTask(categories, task);
        if (!categoryMatches) continue;

        const partnerName = (p.name || p.fullName || 'Partner') as string;
        const isApproved = pp.status === 'approved' || p.isActive === true;
        const onLeave = p.isActive === false || pp.onLeave === true || p.isAvailable === false;

        const workShifts: string[] = Array.isArray(pp.workShifts) ? pp.workShifts : [];
        const shiftLabel = formatShiftLabel(workShifts);
        const timingMatches = checkTimingMatch(workShifts, task);
        const partnerGender = readPartnerGender(p as Record<string, unknown>);
        const isGenderMismatch =
          isHourly &&
          preferredGender &&
          normalizePartnerGender(partnerGender) !== preferredGender;

        // Distance
        let distKm: number | null = null;
        const pCoords = (p.homeLocation as any)?.coordinates || (p.location as any)?.coordinates;
        if (taskCoords && Array.isArray(pCoords) && pCoords.length === 2 && pCoords[1] !== 0) {
          distKm = haversineKm(taskCoords.lat, taskCoords.lng, pCoords[1], pCoords[0]);
        } else {
          distKm = wa.distKm + 0.8;
        }

        const isThisAssigned = Boolean(assignedUid && (String(p.uid) === String(assignedUid) || String(p._id) === String(assignedUid)));

        if (!isApproved || onLeave) {
          candidates.push({
            partnerId: String(p._id),
            partnerUid: String(p.uid),
            name: partnerName,
            status: 'ineligible',
            shiftTiming: shiftLabel,
            distanceKm: distKm,
            details: 'on leave today',
            reasons: ['on leave today'],
            gender: partnerGender,
            genderCheckResult: isHourly && preferredGender
              ? (normalizePartnerGender(partnerGender) === preferredGender ? 'passed' : 'failed')
              : null,
          });
        } else if (!timingMatches) {
          candidates.push({
            partnerId: String(p._id),
            partnerUid: String(p.uid),
            name: partnerName,
            status: 'ineligible',
            shiftTiming: shiftLabel,
            distanceKm: distKm,
            details: `shift ${shiftLabel}, no overlap with ${taskTimeString} job`,
            reasons: [`shift ${shiftLabel}, no overlap with ${taskTimeString} job`],
            gender: partnerGender,
            genderCheckResult: isHourly && preferredGender
              ? (normalizePartnerGender(partnerGender) === preferredGender ? 'passed' : 'failed')
              : null,
          });
        } else if (isGenderMismatch) {
          candidates.push({
            partnerId: String(p._id),
            partnerUid: String(p.uid),
            name: partnerName,
            status: 'ineligible',
            shiftTiming: shiftLabel,
            distanceKm: distKm,
            details: `gender preference is ${preferredGender}, partner is ${partnerGender || 'unspecified'}`,
            reasons: [`gender preference is ${preferredGender}`],
            gender: partnerGender,
            genderCheckResult: 'failed',
          });
        } else {
          // Eligible!
          const distStr = distKm != null ? `${distKm.toFixed(1)} km away` : 'nearby';
          if (isThisAssigned) {
            candidates.push({
              partnerId: String(p._id),
              partnerUid: String(p.uid),
              name: partnerName,
              status: 'assigned',
              shiftTiming: shiftLabel,
              distanceKm: distKm,
              details: `shift ${shiftLabel}, ${distStr} — assigned`,
              reasons: [],
              gender: partnerGender,
              genderCheckResult: isHourly && preferredGender ? 'passed' : null,
            });
          } else if (task.status === 'assigned' && !isThisAssigned) {
            candidates.push({
              partnerId: String(p._id),
              partnerUid: String(p.uid),
              name: partnerName,
              status: 'eligible',
              shiftTiming: shiftLabel,
              distanceKm: distKm,
              details: `shift ${shiftLabel}, ${distStr}`,
              reasons: [],
              gender: partnerGender,
              genderCheckResult: isHourly && preferredGender ? 'passed' : null,
            });
          } else {
            candidates.push({
              partnerId: String(p._id),
              partnerUid: String(p.uid),
              name: partnerName,
              status: 'eligible',
              shiftTiming: shiftLabel,
              distanceKm: distKm,
              details: `shift ${shiftLabel}, ${distStr}`,
              reasons: [],
              gender: partnerGender,
              genderCheckResult: isHourly && preferredGender ? 'passed' : null,
            });
          }
        }
      }

      const eligibleCount = candidates.filter((c) => c.status === 'eligible' || c.status === 'assigned' || c.status === 'notified').length;
      const notifiedCount = candidates.filter((c) => c.status === 'notified' || c.status === 'assigned' || c.status === 'timed_out').length;
      const assignedCount = candidates.filter((c) => c.status === 'assigned').length;
      const matchedCategoryCount = candidates.length;

      dispatchAreaLogs.push({
        area: wa.area,
        isJobArea,
        distanceKm: wa.distKm,
        matchedCategoryCount,
        eligibleCount,
        notifiedCount,
        assignedCount,
        acceptedCount: assignedCount,
        candidates,
      });
    }

    return dispatchAreaLogs;
  }

  /**
   * Find the best (nearest) eligible approved partner for a Book Now task.
   */
  static async findBestPartner(task: ITask): Promise<EligiblePartner | null> {
    const Profile = mongoose.connection.collection('profiles');
    const profiles = await Profile.find({
      isActive: true,
      'partnerProfile.status': 'approved',
    }).toArray();

    if (!profiles.length) return null;

    const taskCoords =
      Array.isArray(task.location?.coordinates) && task.location.coordinates.length === 2
        ? { lng: task.location.coordinates[0], lat: task.location.coordinates[1] }
        : null;

    if (isConsultationBookNowTask(task)) {
      return BookNowAutoAssignService.findBestPartnerForConsultation(task, profiles, taskCoords);
    }

    const isHourly = isHourlyTask(task);
    if (isHourly) {
      return BookNowAutoAssignService.findBestHourlyHelper(task, profiles, taskCoords);
    }
    const preferredGender = resolvePreferredHelperGender(task);
    const orderedWorkAreas = buildOrderedWorkAreasForDispatch(task);

    for (const wa of orderedWorkAreas) {
      const areaKey = normalizeArea(wa.area);
      const areaPartners: EligiblePartner[] = [];

      for (const p of profiles) {
        const pp = (p.partnerProfile as any) || {};
        if (pp.status !== 'approved') continue;

        const categories: string[] = Array.isArray(pp.categories) ? pp.categories : [];
        const workAreas: string[] =
          isHourly && Array.isArray(p.helperWorkAreas) && (!Array.isArray(pp.workAreas) || pp.workAreas.length === 0)
            ? (p.helperWorkAreas as string[])
            : Array.isArray(pp.workAreas)
            ? pp.workAreas
            : Array.isArray(p.helperWorkAreas)
            ? (p.helperWorkAreas as string[])
            : [];

        if (!categories.length || !workAreas.length) continue;

        if (!partnerCategoryMatchesBookNowTask(categories, task)) continue;

        if (!partnerMatchesWorkArea(workAreas, areaKey)) continue;

        const workShifts: string[] = Array.isArray(pp.workShifts) ? pp.workShifts : [];
        if (!checkTimingMatch(workShifts, task)) continue;

        const partnerGender = readPartnerGender(p as Record<string, unknown>);

        // STRICT GENDER MATCH FOR HOURLY WORKS:
        if (isHourly && preferredGender) {
          if (normalizePartnerGender(partnerGender) !== preferredGender) {
            continue;
          }
        }

        const distKm = resolvePartnerDistanceKm(taskCoords, p as Record<string, unknown>);

        areaPartners.push({
          uid: String(p.uid),
          profileId: String(p._id),
          name: (p.name || p.fullName || 'Partner') as string,
          distKm,
          workArea: wa.area,
          workAreaDistKm: wa.distKm,
          gender: partnerGender,
        });
      }

      if (areaPartners.length === 0) continue;

      if (isHourly && preferredGender) {
        return sortPartnersByDistance(areaPartners)[0];
      }

      return sortPartnersByPreferenceThenDistance(
        areaPartners,
        preferredGender,
      )[0];
    }

    return null;
  }

  /** Hourly Helper: exact named-area match only (no nearby-area expansion). */
  private static findBestHourlyHelper(
    task: ITask,
    profiles: Record<string, unknown>[],
    taskCoords: { lng: number; lat: number } | null,
  ): EligiblePartner | null {
    const location = (task.location || {}) as Record<string, unknown>;
    const candidates = buildHourlyServiceAreaCandidates({
      area: location.taskArea as string | undefined,
      city: location.city as string | undefined,
      state: location.state as string | undefined,
      address: location.address as string | undefined,
    });
    const preferredGender = resolvePreferredHelperGender(task);
    const eligible: EligiblePartner[] = [];

    for (const p of profiles) {
      const matchedArea = matchEligibleHourlyHelperArea(p, candidates);
      if (!matchedArea) continue;

      const pp = (p.partnerProfile as Record<string, unknown>) || {};
      const workShifts: string[] = Array.isArray(pp.workShifts) ? (pp.workShifts as string[]) : [];
      if (!checkTimingMatch(workShifts, task)) continue;

      const partnerGender = readPartnerGender(p);
      if (preferredGender && normalizePartnerGender(partnerGender) !== preferredGender) continue;

      eligible.push({
        uid: String(p.uid),
        profileId: String(p._id),
        name: String(p.name || p.fullName || 'Partner'),
        distKm: resolvePartnerDistanceKm(taskCoords, p),
        workArea: matchedArea,
        workAreaDistKm: 0,
        gender: partnerGender,
      });
    }

    if (!eligible.length) return null;
    if (preferredGender) {
      return sortPartnersByDistance(eligible)[0];
    }
    return sortPartnersByPreferenceThenDistance(eligible, preferredGender)[0];
  }

  private static findBestPartnerForConsultation(
    task: ITask,
    profiles: Record<string, unknown>[],
    taskCoords: { lng: number; lat: number } | null,
  ): EligiblePartner | null {
    const postedArea =
      task.location?.taskArea ||
      (task.location as any)?.locality ||
      task.location?.city ||
      'Consultation area';
    const eligible: EligiblePartner[] = [];
    const isHourly = isHourlyTask(task);
    const preferredGender = resolvePreferredHelperGender(task);

    for (const p of profiles) {
      const pp = (p.partnerProfile as Record<string, unknown>) || {};
      if (pp.status !== 'approved') continue;

      const categories: unknown[] = Array.isArray(pp.categories) ? pp.categories : [];
      if (!categories.length) continue;
      if (!partnerCategoryMatchesBookNowTask(categories, task)) continue;

      const workShifts: unknown[] = Array.isArray(pp.workShifts) ? pp.workShifts : [];
      if (!checkTimingMatch(workShifts as string[], task)) continue;

      const partnerGender = readPartnerGender(p);
      if (isHourly && preferredGender) {
        if (normalizePartnerGender(partnerGender) !== preferredGender) {
          continue;
        }
      }

      eligible.push({
        uid: String(p.uid),
        profileId: String(p._id),
        name: String(p.name || p.fullName || 'Partner'),
        distKm: resolvePartnerDistanceKm(taskCoords, p),
        workArea: postedArea,
        workAreaDistKm: 0,
        gender: partnerGender,
      });
    }

    if (!eligible.length) return null;
    if (isHourly && preferredGender) {
      return sortPartnersByDistance(eligible)[0];
    }
    return sortPartnersByPreferenceThenDistance(
      eligible,
      preferredGender,
    )[0];
  }

  private static async findPreferredPartnerForTask(
    task: ITask,
    partnerUid: string,
  ): Promise<EligiblePartner | null> {
    const uid = String(partnerUid || '').trim();
    if (!uid) return null;

    const Profile = mongoose.connection.collection('profiles');
    const profile = await Profile.findOne({ uid, isActive: true });
    if (!profile) return null;

    const pp = (profile.partnerProfile as any) || {};
    if (pp.status !== 'approved') return null;
    if (pp.onLeave === true || profile.isAvailable === false) return null;

    const categories: string[] = Array.isArray(pp.categories) ? pp.categories : [];
    if (!partnerCategoryMatchesBookNowTask(categories, task)) return null;

    const workShifts: string[] = Array.isArray(pp.workShifts) ? pp.workShifts : [];
    if (!checkTimingMatch(workShifts, task)) return null;

    if (!isConsultationBookNowTask(task)) {
      const postedArea = normalizeArea(
        String(task.location?.taskArea || (task.location as any)?.locality || task.location?.city || ''),
      );
      const workAreas: string[] = Array.isArray(pp.workAreas)
        ? pp.workAreas
        : Array.isArray(profile.helperWorkAreas)
          ? profile.helperWorkAreas
          : [];
      if (postedArea && (!workAreas.length || !workAreas.some((area) => partnerMatchesWorkArea([area], postedArea)))) {
        return null;
      }
    }

    const partnerGender = readPartnerGender(profile as Record<string, unknown>);
    if (isHourlyTask(task)) {
      const preferredGender = resolvePreferredHelperGender(task);
      if (preferredGender && normalizePartnerGender(partnerGender) !== preferredGender) {
        return null;
      }
    }

    const postedArea =
      task.location?.taskArea ||
      (task.location as any)?.locality ||
      task.location?.city ||
      'Preferred partner';

    return {
      uid,
      profileId: String(profile._id),
      name: (profile.name || profile.fullName || 'Partner') as string,
      distKm: null,
      workArea: postedArea,
      workAreaDistKm: 0,
      gender: partnerGender,
    };
  }

  private static async syncExistingAssignee(
    task: ITask,
    partnerUid: string,
  ): Promise<AutoAssignResult | null> {
    const uid = String(partnerUid || '').trim();
    if (!uid) return null;

    const preferred = await BookNowAutoAssignService.findPreferredPartnerForTask(task, uid);
    if (!preferred) return null;

    const dispatchLogs = await BookNowAutoAssignService.buildDispatchLog(task, preferred.uid);
    await BookNowAutoAssignService.persistPartnerAssignment(task, preferred, dispatchLogs, {
      notifyPartner: false,
    });

    return { assigned: true, partner: preferred, dispatchLogs };
  }

  private static async persistPartnerAssignment(
    task: ITask,
    partner: EligiblePartner,
    dispatchLogs: IDispatchAreaLog[],
    options?: { notifyPartner?: boolean },
  ): Promise<void> {
    const taskId = String(task._id);
    const partnerProfileObjId = new mongoose.Types.ObjectId(partner.profileId);

    await Assignment.updateMany(
      { taskId: task._id, status: { $in: ['assigned', 'pending'] } },
      { $set: { status: 'cancelled' } },
    );

    const bookingOrderId = (task as any).bookingOrderId;
    const bookingItemId = (task as any).bookingItemId;

    const assignment = await Assignment.create({
      bookingOrderId: bookingOrderId || 'auto',
      bookingItemId: bookingItemId
        ? new mongoose.Types.ObjectId(bookingItemId)
        : task._id,
      taskId: task._id,
      helperUid: partner.uid,
      helperProfileId: partnerProfileObjId,
      assignmentMode: 'auto',
      status: 'assigned',
      assignedByUid: 'system',
      assignedAt: new Date(),
    });

    await AssignmentLog.create({
      assignmentId: assignment._id,
      action: 'auto_partner_assign_book_now',
      actorUid: 'system',
      metadata: {
        partnerUid: partner.uid,
        partnerProfileId: partner.profileId,
        workArea: partner.workArea,
        workAreaDistKm: partner.workAreaDistKm,
        partnerDistKm: partner.distKm,
      },
    });

    await Task.findByIdAndUpdate(
      task._id,
      {
        $set: {
          assigneeId: partnerProfileObjId,
          assigneeUid: partner.uid,
          assigneeName: partner.name,
          assignedHelperName: partner.name,
          assignedToName: partner.name,
          partnerId: partnerProfileObjId,
          partnerUid: partner.uid,
          partnerAcceptedAt: new Date(),
          assignedAt: new Date(),
          status: 'assigned',
          assignmentStatus: 'assigned',
          dispatchLogs,
        },
        $unset: { assignmentOffer: '' },
      },
      { new: true },
    );

    void notifyBookNowAssignment({
      actorUid: 'system',
      taskId,
      taskTitle: String(task.title || 'your booking'),
      customerUid: String((task as any).requesterUid || '').trim() || undefined,
      customerProfileId: task.requesterId,
      helperUid: partner.uid,
      helperName: partner.name,
      notifyPartner: false,
      notifyCustomer: true,
      recipientRole: 'partner',
    }).catch((err: any) => {
      logger.warn('[BookNowAutoAssign] Failed to send customer assignment notification', {
        taskId,
        customerUid: (task as any).requesterUid,
        helperUid: partner.uid,
        error: err?.message,
      });
    });

    if (options?.notifyPartner === false) return;

    try {
      const categoryLabel = (task as any).categoryLabel || task.category || 'service';
      const taskAmount =
        typeof task.budget === 'object' && task.budget?.amount ? task.budget.amount : 0;
      const taskLocation = task.location as any;
      const locationAddress = taskLocation?.address || '';
      const locationCity = taskLocation?.city || taskLocation?.taskArea || '';

      await NotificationClient.send({
        eventKey: 'BOOK_NOW_PARTNER_ASSIGNED',
        category: 'taskUpdates',
        recipients: [partner.uid],
        entity: { type: 'task', id: taskId },
        title: 'New Book Now Work Assigned!',
        body: `${task.title || categoryLabel} - Tap to view details`,
        data: {
          taskId,
          title: task.title,
          category: task.category,
          categoryLabel,
          bookingSource: 'book_now',
          eventKey: 'BOOK_NOW_PARTNER_ASSIGNED',
          budgetAmount: taskAmount,
          amount: taskAmount,
          address: locationAddress,
          locationAddress,
          city: locationCity,
          taskArea: locationCity,
          scheduledTimeStart: task.scheduledTimeStart || task.timeSlot || '',
          scheduledDate: task.scheduledDate || '',
          distance: partner.distKm != null ? Number(partner.distKm.toFixed(1)) : undefined,
          partnerName: partner.name,
          workArea: partner.workArea,
        },
      });
    } catch (notifErr) {
      logger.warn(
        `[BookNowAutoAssign] ⚠️ Failed to send ring notification for task ${taskId}:`,
        notifErr,
      );
    }
  }

  /**
   * Auto-assign the Book Now task to the best matching partner.
   * Generates and stores dispatch evaluation logs on the task document.
   */
  static async forceAssignPartner(
    task: ITask,
    partnerUid: string,
  ): Promise<AutoAssignResult> {
    const uid = String(partnerUid || '').trim();
    if (!uid) {
      return { assigned: false, reason: 'Partner uid is required' };
    }

    const preferred = await BookNowAutoAssignService.findPreferredPartnerForTask(task, uid);
    if (!preferred) {
      return {
        assigned: false,
        reason: 'Preferred partner is not approved or does not match task category',
      };
    }

    const dispatchLogs = await BookNowAutoAssignService.buildDispatchLog(task, preferred.uid);
    await BookNowAutoAssignService.persistPartnerAssignment(task, preferred, dispatchLogs);
    return { assigned: true, partner: preferred, dispatchLogs };
  }

  private static async isExcludedCustomer(task: ITask): Promise<boolean> {
    const rules = await AssignmentManagementRules.findOne({ key: 'assignment_management' }).lean();
    const excludedPhones = rules?.excludedPhones || [];
    if (!excludedPhones.length) return false;

    const requesterUid = String((task as any).requesterUid || '').trim();
    const requesterId = String((task as any).requesterId || (task as any).CustomerId || '').trim();
    const Profile = mongoose.connection.collection('profiles');
    const profileQuery: Record<string, unknown>[] = [];
    if (requesterUid) profileQuery.push({ uid: requesterUid });
    if (requesterId) profileQuery.push({ uid: requesterId });
    if (requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
      profileQuery.push({ _id: new mongoose.Types.ObjectId(requesterId) });
    }
    const profile = profileQuery.length ? await Profile.findOne({ $or: profileQuery }) : null;
    const phone =
      (task as any).requesterPhone ||
      (task as any).customerPhone ||
      (profile as any)?.phone ||
      (profile as any)?.phoneNumber;
    return phoneMatchesExcluded(phone, excludedPhones);
  }

  private static async findConfiguredPreferredPartner(task: ITask, rotationAttempt = 0): Promise<EligiblePartner | null> {
    const rules = await AssignmentManagementRules.findOne({ key: 'assignment_management' }).lean();
    const hourly = isHourlyTask(task);
    const globalPreferredPartners = hourly ? (rules?.preferredPartners || []) : [];
    let preferredPartnerCursor = Number(rules?.preferredPartnerCursor || 0);

    const taskArea = normalizeArea(String(
      task.location?.taskArea || (task.location as any)?.locality || task.location?.city || '',
    ));
    const areaRule = (rules?.areaRules || []).find((rule) => {
      const ruleArea = normalizeArea(rule.area);
      const appliesToWorkType = rule.workTypes.includes('all') ||
        (hourly && rule.workTypes.includes('hourly')) ||
        (!hourly && rule.workTypes.includes('book_now'));
      return rule.active !== false && appliesToWorkType && !!taskArea && (ruleArea === taskArea || ruleArea.includes(taskArea) || taskArea.includes(ruleArea));
    });
    const rotatedPreferredPartners = globalPreferredPartners.length > 0
      ? [
        ...globalPreferredPartners.slice(preferredPartnerCursor % globalPreferredPartners.length),
        ...globalPreferredPartners.slice(0, preferredPartnerCursor % globalPreferredPartners.length),
      ]
      : [];
    const orderedPartners = [
      ...(areaRule?.preferredPartners || []),
      ...rotatedPreferredPartners,
    ].filter((partner, index, partners) => partner.active !== false && partners.findIndex((item) => item.uid === partner.uid) === index);

    for (const partner of orderedPartners) {
      const eligible = await BookNowAutoAssignService.findPreferredPartnerForTask(task, partner.uid);
      if (!eligible) continue;

      const selectedGlobalIndex = rotatedPreferredPartners.findIndex((item) => item.uid === partner.uid);
      if (hourly && selectedGlobalIndex >= 0) {
        const nextCursor = (preferredPartnerCursor + selectedGlobalIndex + 1) % globalPreferredPartners.length;
        const cursorFilter = rules?.preferredPartnerCursor == null
          ? { key: 'assignment_management', $or: [{ preferredPartnerCursor: { $exists: false } }, { preferredPartnerCursor: 0 }] }
          : { key: 'assignment_management', preferredPartnerCursor };
        const cursorUpdate = await AssignmentManagementRules.updateOne(
          cursorFilter,
          { $set: { preferredPartnerCursor: nextCursor } },
        );
        if (cursorUpdate.matchedCount === 0 && rotationAttempt < 3) {
          return BookNowAutoAssignService.findConfiguredPreferredPartner(task, rotationAttempt + 1);
        }
      }

      return eligible;
    }
    return null;
  }

  static async autoAssign(task: ITask, options?: AutoAssignOptions): Promise<AutoAssignResult> {
    const taskId = String(task._id);

    try {
      if (task.bookingSource === 'book_now') {
        return BookNowAutoAssignService.dispatchBookNowOffers(
          task,
          String(options?.preferredPartnerUid || '').trim() || undefined,
        );
      }

      if (await BookNowAutoAssignService.isExcludedCustomer(task)) {
        logger.info('[BookNowAutoAssign] Customer is excluded from automatic assignment', { taskId });
        return { assigned: false, reason: 'Customer phone is excluded from automatic assignment' };
      }

      const devPreferredUid = await resolvePaintingConsultationPreferredPartnerUid(task);
      const existingUid = String(task.assigneeUid || task.partnerUid || '').trim();

      if (devPreferredUid && existingUid && existingUid !== devPreferredUid) {
        logger.info('[BookNowAutoAssign] Dev painting consultation override — reassigning partner', {
          taskId,
          fromUid: existingUid,
          toUid: devPreferredUid,
        });
        return BookNowAutoAssignService.forceAssignPartner(task, devPreferredUid);
      }

      if (existingUid) {
        const synced = await BookNowAutoAssignService.syncExistingAssignee(task, existingUid);
        if (synced?.assigned) {
          return synced;
        }
      }

      const preferredUid =
        String(options?.preferredPartnerUid || '').trim() || devPreferredUid || '';
      let best = preferredUid
        ? await BookNowAutoAssignService.findPreferredPartnerForTask(task, preferredUid)
        : null;
      if (!best) {
        best = await BookNowAutoAssignService.findConfiguredPreferredPartner(task);
      }
      if (!best) {
        best = await BookNowAutoAssignService.findBestPartner(task);
      }
      const dispatchLogs = await BookNowAutoAssignService.buildDispatchLog(task, best?.uid);

      if (!best) {
        const postedArea = task.location?.taskArea || (task.location as any)?.locality || task.location?.city || 'N/A';
        const timeInfo = task.scheduledTimeStart || task.timeSlot || 'Flexible';
        const catInfo = (task as any).categoryLabel || task.category || 'N/A';

        // Update task with dispatch logs even when unassigned
        await Task.findByIdAndUpdate(task._id, {
          $set: { dispatchLogs },
        });

        logger.info(`================================================================================`);
        logger.info(`📢 [BookNowWorkPosted] BOOK NOW WORK POSTED!`);
        logger.info(`   Task ID           : ${taskId}`);
        logger.info(`   Task Title        : "${task.title}"`);
        logger.info(`   Category          : ${catInfo}`);
        logger.info(`   Work Posted Area  : ${postedArea}`);
        logger.info(`   Work Scheduled    : ${timeInfo}`);
        logger.info(`--------------------------------------------------------------------------------`);
        const isHourly = isHourlyTask(task);
        const preferredGender = resolvePreferredHelperGender(task);
        const reason =
          isHourly && preferredGender
            ? `No eligible approved ${preferredGender} partner found within 5km work areas`
            : 'No eligible approved partner found within 5km work areas';

        return { assigned: false, reason, dispatchLogs };
      }

      await BookNowAutoAssignService.persistPartnerAssignment(task, best, dispatchLogs, {
        notifyPartner: options?.notifyPartner,
      });

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

      return { assigned: true, partner: best, dispatchLogs };
    } catch (err) {
      logger.error(`[BookNowAutoAssign] ❌ Error during auto-assignment for task ${taskId}:`, err);
      return { assigned: false, reason: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}
