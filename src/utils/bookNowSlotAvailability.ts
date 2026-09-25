import BookingOrder, { type BookingOrderStatus } from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import Task from '../models/Task';
import mongoose from 'mongoose';
import {
  BOOK_NOW_WORK_AREA_PROXIMITY_KM,
  HYDERABAD_WORK_AREA_COORDS,
} from '../constants/locations/hyderabadWorkAreaCoords';

/** Only confirmed (paid) bookings block slots — not unpaid checkouts. */
const BLOCKING_STATUSES: BookingOrderStatus[] = ['paid', 'assigning', 'assigned'];

/** Each Book Now booking blocks only the exact selected start slot. */
export const BOOK_NOW_SLOTS_BLOCKED_PER_BOOKING = 1;

/** Same-day slots that have already started are rejected. No extra lead buffer. */
export const BOOK_NOW_MIN_LEAD_TIME_MINUTES = 0;
/** Standard services cannot be booked inside the next three hours. */
export const BOOK_NOW_STANDARD_MIN_LEAD_TIME_MINUTES = 3 * 60;

const BOOK_NOW_SLOT_STEP_MINUTES = 30;

export type BookNowTimeBucket = 'morning' | 'midday' | 'afternoon' | 'evening';

export type BookNowOccupiedSlots = {
  occupiedTimeStarts: string[];
  occupiedTimeSlots: BookNowTimeBucket[];
  /** Raw booked start times — used to detect overlapping blocked windows. */
  occupiedBookingAnchors: string[];
};

function parseHourlySlotToMinutes(slot: string): number | null {
  const match = String(slot || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function minutesToSlotLabel(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

export function expandBlockedSlotsFromAnchor(
  anchorSlot: string,
  count = BOOK_NOW_SLOTS_BLOCKED_PER_BOOKING,
): string[] {
  const startMinutes = parseHourlySlotToMinutes(anchorSlot);
  if (startMinutes == null) {
    const trimmed = String(anchorSlot || '').trim();
    return trimmed ? [trimmed] : [];
  }

  const slots: string[] = [];
  for (let i = 0; i < count; i += 1) {
    slots.push(minutesToSlotLabel(startMinutes + i * BOOK_NOW_SLOT_STEP_MINUTES));
  }
  return slots;
}

export function bookNowSlotWindowsOverlap(anchorA: string, anchorB: string): boolean {
  const windowA = new Set(expandBlockedSlotsFromAnchor(anchorA));
  return expandBlockedSlotsFromAnchor(anchorB).some((slot) => windowA.has(slot));
}

export function deriveBookNowTimeSlot(anchorSlot: string): BookNowTimeBucket {
  const startMinutes = parseHourlySlotToMinutes(anchorSlot);
  if (startMinutes == null) return 'morning';
  if (startMinutes < 11 * 60) return 'morning';
  if (startMinutes < 14 * 60) return 'midday';
  if (startMinutes < 17 * 60) return 'afternoon';
  return 'evening';
}

function bucketAnchorSlot(bucket: BookNowTimeBucket): string {
  switch (bucket) {
    case 'morning':
      return '7:00 AM';
    case 'midday':
      return '11:00 AM';
    case 'afternoon':
      return '2:00 PM';
    case 'evening':
      return '5:00 PM';
    default:
      return '8:00 AM';
  }
}

function normalizeCity(city: string): string {
  return String(city || '').trim();
}

/** India calendar day — matches how customers pick dates in the app. */
const BOOK_NOW_SLOT_TIMEZONE = '+05:30';

function bookingDateRange(date: string): { start: Date; end: Date } | null {
  const trimmed = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return {
    start: new Date(`${trimmed}T00:00:00.000${BOOK_NOW_SLOT_TIMEZONE}`),
    end: new Date(`${trimmed}T23:59:59.999${BOOK_NOW_SLOT_TIMEZONE}`),
  };
}

export function normalizeBookNowSlotLabel(slot: string): string {
  const startMinutes = parseHourlySlotToMinutes(slot);
  if (startMinutes == null) return String(slot || '').trim();
  return minutesToSlotLabel(startMinutes);
}

function getIstDateAndMinutes(now = new Date()): { dateKey: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** True when booking today (IST) and the slot start is already in the past. */
export function isBookNowSlotWithinLeadTime(
  slot: string,
  date: string,
  now = new Date(),
  leadTimeMinutes = BOOK_NOW_MIN_LEAD_TIME_MINUTES,
): boolean {
  const dateKey = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;

  const { dateKey: todayKey, minutes: nowMinutes } = getIstDateAndMinutes(now);
  if (dateKey !== todayKey) return false;

  const slotMinutes = parseHourlySlotToMinutes(slot);
  if (slotMinutes == null) return false;
  return slotMinutes < nowMinutes + Math.max(0, leadTimeMinutes);
}

function buildCityFilter(city: string) {
  const normalized = normalizeCity(city);
  if (!normalized) return null;
  return { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
}

function addAnchorToOccupied(
  anchor: string,
  occupiedTimeStarts: Set<string>,
  occupiedTimeSlots: Set<BookNowTimeBucket>,
  occupiedBookingAnchors: Set<string>,
  blockedDurationMinutes = BOOK_NOW_SLOT_STEP_MINUTES,
) {
  const trimmed = normalizeBookNowSlotLabel(anchor);
  if (!trimmed) return;

  occupiedBookingAnchors.add(trimmed);
  const blockedSlotCount = Math.max(1, Math.ceil(blockedDurationMinutes / BOOK_NOW_SLOT_STEP_MINUTES));
  for (const slot of expandBlockedSlotsFromAnchor(trimmed, blockedSlotCount)) {
    occupiedTimeStarts.add(slot);
    occupiedTimeSlots.add(deriveBookNowTimeSlot(slot));
  }
}

function resolveScheduleAnchor(input: {
  scheduledTimeStart?: string | null;
  timeSlot?: BookNowTimeBucket | null;
}): string | null {
  const start = String(input.scheduledTimeStart || '').trim();
  if (start) return start;
  if (input.timeSlot) return bucketAnchorSlot(input.timeSlot);
  return null;
}

function isScheduledDateOnQueryDate(scheduledDate: Date | undefined, range: { start: Date; end: Date }): boolean {
  if (!scheduledDate) return false;
  const time = scheduledDate.getTime();
  return time >= range.start.getTime() && time <= range.end.getTime();
}

export async function getOccupiedBookNowSlots(
  date: string,
  city: string,
  blockedDurationMinutes = BOOK_NOW_SLOT_STEP_MINUTES,
  location?: { lat?: number; lng?: number },
): Promise<BookNowOccupiedSlots> {
  const range = bookingDateRange(date);
  const cityFilter = buildCityFilter(city);
  if (!range || !cityFilter) {
    return { occupiedTimeStarts: [], occupiedTimeSlots: [], occupiedBookingAnchors: [] };
  }

  const orders = await BookingOrder.find({
    'address.city': cityFilter,
    status: { $in: BLOCKING_STATUSES },
  })
    .select('orderId scheduledDate scheduledTimeStart timeSlot address.coordinates')
    .lean();

  const requestLat = Number(location?.lat);
  const requestLng = Number(location?.lng);
  const hasRequestCoordinates =
    Number.isFinite(requestLat) &&
    Number.isFinite(requestLng) &&
    !(requestLat === 0 && requestLng === 0);
  const relevantOrders = hasRequestCoordinates
    ? orders.filter((order) => {
        const coordinates = (order.address as { coordinates?: unknown } | undefined)?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
        const orderLng = Number(coordinates[0]);
        const orderLat = Number(coordinates[1]);
        return (
          Number.isFinite(orderLat) &&
          Number.isFinite(orderLng) &&
          haversineKm(requestLat, requestLng, orderLat, orderLng) <=
            BOOK_NOW_WORK_AREA_PROXIMITY_KM
        );
      })
    : orders;

  if (!relevantOrders.length) {
    return { occupiedTimeStarts: [], occupiedTimeSlots: [], occupiedBookingAnchors: [] };
  }

  const orderIds = relevantOrders.map((order) => order.orderId);
  const items = await BookingItem.find({
    orderId: { $in: orderIds },
    status: { $ne: 'cancelled' },
    scheduledDate: { $gte: range.start, $lte: range.end },
  })
    .select('orderId scheduledDate scheduledTimeStart timeSlot')
    .lean();

  const occupiedTimeStarts = new Set<string>();
  const occupiedTimeSlots = new Set<BookNowTimeBucket>();
  const occupiedBookingAnchors = new Set<string>();
  const ordersWithItemAnchors = new Set<string>();

  for (const item of items) {
    const anchor = resolveScheduleAnchor(item);
    if (!anchor) continue;
    addAnchorToOccupied(
      anchor,
      occupiedTimeStarts,
      occupiedTimeSlots,
      occupiedBookingAnchors,
      blockedDurationMinutes,
    );
    ordersWithItemAnchors.add(item.orderId);
  }

  for (const order of relevantOrders) {
    if (ordersWithItemAnchors.has(order.orderId)) continue;
    if (!isScheduledDateOnQueryDate(order.scheduledDate, range)) continue;

    const anchor = resolveScheduleAnchor(order);
    if (anchor) {
      addAnchorToOccupied(
        anchor,
        occupiedTimeStarts,
        occupiedTimeSlots,
        occupiedBookingAnchors,
        blockedDurationMinutes,
      );
      continue;
    }

    const bucket = order.timeSlot;
    if (bucket) {
      addAnchorToOccupied(
        bucketAnchorSlot(bucket),
        occupiedTimeStarts,
        occupiedTimeSlots,
        occupiedBookingAnchors,
        blockedDurationMinutes,
      );
      occupiedTimeSlots.add(bucket);
    }
  }

  return {
    occupiedTimeStarts: [...occupiedTimeStarts],
    occupiedTimeSlots: [...occupiedTimeSlots],
    occupiedBookingAnchors: [...occupiedBookingAnchors],
  };
}

function slotHasZeroPartnerCapacity(
  capacity: PartnerCapacityBySlot,
  slot: string,
): boolean {
  const key = normalizeBookNowSlotLabel(slot);
  const value = capacity[key];
  return typeof value === 'number' && value === 0;
}

// ─── Partner capacity ─────────────────────────────────────────────────────────

/**
 * Map of slot-start label → number of eligible partners who are FREE to
 * perform a service that starts at that slot.
 *
 * Only slot-start labels that appear in BOOK_NOW_START_TIME_SLOTS (7:00 AM –
 * 8:00 PM, 30-min steps) are emitted. A missing key means "not yet computed"
 * 7:00 PM, 30-min steps) are emitted. A missing key means "not yet computed"
 * (treat the same as the capacity being unknown, not zero).
 *
 * A value of 0 means every eligible partner is occupied during that window.
 */
export type PartnerCapacityBySlot = Record<string, number>;

/** Active task statuses that mean a partner is occupied. */
const PARTNER_OCCUPIED_TASK_STATUSES = new Set([
  'assigned',
  'started',
  'in_progress',
  'review',
]);

/** Slot grid: 7:00 AM – 8:00 PM in 30-minute steps (mirrors BOOK_NOW_START_TIME_SLOTS). */
function buildSlotGrid(): number[] {
  const grid: number[] = [];
  for (let t = 7 * 60; t <= 20 * 60; t += 30) grid.push(t);
  return grid;
}
const SLOT_GRID_MINUTES = buildSlotGrid();

/** Same shift windows as BookNowAutoAssignService.checkTimingMatch. */
const SHIFT_WINDOWS: Record<string, { startHour: number; endHour: number }> = {
  morning_rush: { startHour: 8.0, endHour: 12.0 },
  morning_block: { startHour: 8.0, endHour: 12.0 },
  midday_block: { startHour: 12.0, endHour: 16.0 },
  mid_day_block: { startHour: 12.0, endHour: 16.0 },
  afternoon_block: { startHour: 15.5, endHour: 19.5 },
  morning_full_time: { startHour: 8.0, endHour: 16.0 },
  general_day_full_time: { startHour: 10.0, endHour: 18.0 },
  evening_full_time: { startHour: 11.5, endHour: 19.5 },
};

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

function normalizeAreaKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_\s]+/g, '');
}

/** Same includes-match BookNowAutoAssignService uses for work areas. */
export function partnerWorkAreasMatchLocationKeys(
  workAreas: string[],
  locationKeys: string[],
): boolean {
  const normAreas = workAreas.map((area) => normalizeAreaKey(area)).filter(Boolean);
  const keys = locationKeys.map((key) => normalizeAreaKey(key)).filter(Boolean);
  if (!normAreas.length || !keys.length) return false;
  return keys.some((key) =>
    normAreas.some((area) => area === key || area.includes(key) || key.includes(area)),
  );
}

export function locationKeysForPartnerCapacity(params: {
  city?: string;
  area?: string;
  lat?: number;
  lng?: number;
}): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (raw?: string) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const norm = normalizeAreaKey(value);
    if (!norm || seen.has(norm)) return;
    // Ignore saved-address nicknames — they are not work areas.
    if (/^(home|work|other|office|default)$/i.test(norm)) return;
    seen.add(norm);
    keys.push(value);
  };

  add(params.area);
  add(params.city);

  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const hasCoords =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);

  if (hasCoords) {
    for (const wa of HYDERABAD_WORK_AREA_COORDS) {
      if (haversineKm(lat, lng, wa.lat, wa.lng) <= BOOK_NOW_WORK_AREA_PROXIMITY_KM) {
        add(wa.area);
      }
    }
  }

  // Only expand the full Hyderabad work-area list when the client did not
  // send a real neighbourhood (e.g. city-only "Hyderabad"). If area=Uppal,
  // keep capacity scoped to Uppal + nearby — do not count the whole city.
  const cityNorm = normalizeAreaKey(params.city || '');
  const areaNorm = normalizeAreaKey(params.area || '');
  const isHyderabadCity = cityNorm === 'hyderabad' || cityNorm.includes('hyderabad');
  const hasSpecificArea =
    !!areaNorm &&
    areaNorm !== cityNorm &&
    !/^(home|work|other|office|default)$/i.test(areaNorm);

  if (isHyderabadCity && !hasSpecificArea) {
    for (const wa of HYDERABAD_WORK_AREA_COORDS) {
      add(wa.area);
    }
  }

  return keys;
}

/**
 * Empty shifts = do not block (legacy profiles), matching auto-assign.
 * Otherwise the FULL [start, end) interval must fit inside one shift window.
 */
export function workShiftsCoverInterval(
  workShifts: string[],
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (!Array.isArray(workShifts) || workShifts.length === 0) return true;
  const startHour = startMinutes / 60;
  const endHour = endMinutes / 60;
  for (const shiftId of workShifts) {
    const key = String(shiftId || '')
      .toLowerCase()
      .replace(/[-_\s]+/g, '_');
    const window = SHIFT_WINDOWS[key];
    if (window) {
      if (startHour >= window.startHour && endHour <= window.endHour) return true;
      continue;
    }
    if (key.includes('morning') && startHour >= 7 && endHour <= 16) return true;
    if (
      (key.includes('general') || key.includes('day') || key.includes('mid')) &&
      startHour >= 9 &&
      endHour <= 18
    ) {
      return true;
    }
    if (
      (key.includes('evening') || key.includes('afternoon')) &&
      startHour >= 11.5 &&
      endHour <= 19.5
    ) {
      return true;
    }
  }
  return false;
}

export type PartnerCapacityLocation = {
  area?: string;
  lat?: number;
  lng?: number;
  requiredPartnerUid?: string;
  excludeOrderId?: string;
  excludeTaskIds?: string[];
};

type EligibleCapacityPartner = {
  uid: string;
  workShifts: string[];
};

/**
 * For a given date + city, return the number of eligible approved partners
 * who can perform the COMPLETE `requestedDurationMinutes` starting at each
 * 30-minute slot.
 *
 * Eligibility matches BookNowAutoAssignService (approved, active, not on leave,
 * work-area includes neighbourhood/city and nearby 6 km areas).
 *
 * Occupied = active Task whose scheduled window overlaps
 * [slotStart, slotStart + requestedDuration).
 */
export async function getPartnerCapacityForSlots(
  date: string,
  city: string,
  requestedDurationMinutes: number,
  location?: PartnerCapacityLocation,
): Promise<PartnerCapacityBySlot> {
  const capacity: PartnerCapacityBySlot = {};

  const range = bookingDateRange(date);
  if (!range) return capacity;

  const safeDuration =
    Number.isFinite(requestedDurationMinutes) && requestedDurationMinutes > 0
      ? Math.round(requestedDurationMinutes)
      : BOOK_NOW_SLOT_STEP_MINUTES;

  const locationKeys = locationKeysForPartnerCapacity({
    city,
    area: location?.area,
    lat: location?.lat,
    lng: location?.lng,
  });
  if (!locationKeys.length) return capacity;

  const Profile = mongoose.connection.collection('profiles');
  const profiles = await Profile.find(
    {
      isActive: true,
      'partnerProfile.status': 'approved',
    },
    {
      projection: {
        uid: 1,
        isAvailable: 1,
        helperWorkAreas: 1,
        'partnerProfile.status': 1,
        'partnerProfile.onLeave': 1,
        'partnerProfile.workAreas': 1,
        'partnerProfile.workShifts': 1,
      },
    },
  ).toArray();

  const eligiblePartners: EligibleCapacityPartner[] = [];
  for (const profile of profiles) {
    const record = profile as Record<string, unknown>;
    const pp = (record.partnerProfile as Record<string, unknown>) || {};
    if (pp.status !== 'approved') continue;
    if (record.isAvailable === false || pp.onLeave === true) continue;

    const workAreas: string[] = Array.isArray(pp.workAreas)
      ? (pp.workAreas as string[])
      : Array.isArray(record.helperWorkAreas)
        ? (record.helperWorkAreas as string[])
        : [];
    if (!workAreas.length) continue;
    if (!partnerWorkAreasMatchLocationKeys(workAreas, locationKeys)) continue;

    const uid = String(record.uid || '').trim();
    if (!uid) continue;
    if (location?.requiredPartnerUid && uid !== location.requiredPartnerUid) continue;
    eligiblePartners.push({
      uid,
      workShifts: Array.isArray(pp.workShifts) ? (pp.workShifts as string[]) : [],
    });
  }

  if (!eligiblePartners.length) {
    for (const slotMinutes of SLOT_GRID_MINUTES) {
      capacity[minutesToSlotLabel(slotMinutes)] = 0;
    }
    return capacity;
  }

  const activePartnerUids = eligiblePartners.map((partner) => partner.uid);

  // ── 2. Fetch active tasks for these partners on this date ───────────────────
  const activeTasks = await Task.find({
    assigneeUid: { $in: activePartnerUids },
    status: { $in: [...PARTNER_OCCUPIED_TASK_STATUSES] },
    scheduledDate: { $gte: range.start, $lte: range.end },
    scheduledTimeStart: { $exists: true, $ne: null },
    ...(location?.excludeOrderId ? { bookingOrderId: { $ne: location.excludeOrderId } } : {}),
    ...(location?.excludeTaskIds?.length
      ? { _id: { $nin: location.excludeTaskIds } }
      : {}),
  })
    .select('assigneeUid scheduledTimeStart scheduledTimeEnd estimatedDuration')
    .lean();

  // ── 3. Build per-partner occupied intervals (minutes) ──────────────────────
  const partnerOccupied = new Map<string, Array<{ start: number; end: number }>>();
  for (const uid of activePartnerUids) {
    partnerOccupied.set(uid, []);
  }

  for (const task of activeTasks) {
    const uid = String(task.assigneeUid || '');
    if (!partnerOccupied.has(uid)) continue;

    const startMin = parseHourlySlotToMinutes(String(task.scheduledTimeStart || ''));
    if (startMin == null) continue;

    // Use scheduledTimeEnd if present; otherwise fall back to estimatedDuration,
    // then to one slot step (30 min) as a conservative minimum.
    let endMin: number;
    const endLabel = String(task.scheduledTimeEnd || '').trim();
    const parsedEnd = endLabel ? parseHourlySlotToMinutes(endLabel) : null;
    if (parsedEnd != null && parsedEnd > startMin) {
      endMin = parsedEnd;
    } else {
      const dur = Number((task as any).estimatedDuration || 0);
      endMin = startMin + (Number.isFinite(dur) && dur > 0 ? dur : BOOK_NOW_SLOT_STEP_MINUTES);
    }

    partnerOccupied.get(uid)!.push({ start: startMin, end: endMin });
  }

  const partnerByUid = new Map(eligiblePartners.map((partner) => [partner.uid, partner]));

  // ── 4. For each slot, count partners free for the FULL requested interval ───
  for (const slotMinutes of SLOT_GRID_MINUTES) {
    const candidateStart = slotMinutes;
    const candidateEnd = slotMinutes + safeDuration;
    let freeCount = 0;

    for (const [uid, intervals] of partnerOccupied) {
      const partner = partnerByUid.get(uid);
      if (!partner) continue;
      if (!workShiftsCoverInterval(partner.workShifts, candidateStart, candidateEnd)) {
        continue;
      }
      const isBusy = intervals.some(
        ({ start, end }) => candidateStart < end && start < candidateEnd,
      );
      if (!isBusy) freeCount += 1;
    }

    capacity[minutesToSlotLabel(slotMinutes)] = freeCount;
  }

  return capacity;
}

export async function assertBookNowSlotAvailable(params: {
  date?: string;
  city: string;
  scheduledTimeStart?: string;
  timeSlot?: BookNowTimeBucket;
  durationMinutes?: number;
  availabilityMode?: 'hourly' | 'standard';
  area?: string;
  lat?: number;
  lng?: number;
  requiredPartnerUid?: string;
  excludeOrderId?: string;
  excludeTaskIds?: string[];
}): Promise<void> {
  const date = String(params.date || '').trim();
  const city = normalizeCity(params.city);
  const scheduledTimeStart = String(params.scheduledTimeStart || '').trim();
  const timeSlot = params.timeSlot;
  const durationMinutes =
    Number.isFinite(Number(params.durationMinutes)) && Number(params.durationMinutes) > 0
      ? Math.round(Number(params.durationMinutes))
      : BOOK_NOW_SLOT_STEP_MINUTES;

  if (!date || !city) return;

  const leadTimeMinutes =
    params.availabilityMode === 'hourly'
      ? BOOK_NOW_MIN_LEAD_TIME_MINUTES
      : BOOK_NOW_STANDARD_MIN_LEAD_TIME_MINUTES;

  if (
    scheduledTimeStart &&
    isBookNowSlotWithinLeadTime(scheduledTimeStart, date, new Date(), leadTimeMinutes)
  ) {
    throw new Error('SLOT_TOO_SOON');
  }

  const slotToCheck = scheduledTimeStart || (timeSlot ? bucketAnchorSlot(timeSlot) : '');
  if (!slotToCheck) return;

  if (
    !scheduledTimeStart &&
    timeSlot &&
    isBookNowSlotWithinLeadTime(slotToCheck, date, new Date(), leadTimeMinutes)
  ) {
    throw new Error('SLOT_TOO_SOON');
  }

  const capacity = await getPartnerCapacityForSlots(date, city, durationMinutes, {
    area: params.area,
    lat: params.lat,
    lng: params.lng,
    requiredPartnerUid: params.requiredPartnerUid,
    excludeOrderId: params.excludeOrderId,
    excludeTaskIds: params.excludeTaskIds,
  });

  if (slotHasZeroPartnerCapacity(capacity, slotToCheck)) {
    throw new Error(params.requiredPartnerUid ? 'ASSIGNED_HELPER_UNAVAILABLE' : 'SLOT_UNAVAILABLE');
  }
}
