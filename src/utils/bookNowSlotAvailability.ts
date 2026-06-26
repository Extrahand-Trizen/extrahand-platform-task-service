import BookingOrder, { type BookingOrderStatus } from '../models/BookingOrder';

/** Only confirmed (paid) bookings block slots — not unpaid checkouts. */
const BLOCKING_STATUSES: BookingOrderStatus[] = ['paid', 'assigning', 'assigned'];

/** Each Book Now booking blocks only the exact selected start slot. */
export const BOOK_NOW_SLOTS_BLOCKED_PER_BOOKING = 1;

/** Same-day bookings must start at least this many minutes from now. */
export const BOOK_NOW_MIN_LEAD_TIME_MINUTES = 3 * 60;

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
      return '8:00 AM';
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

export function isBookNowSlotWithinLeadTime(
  slot: string,
  date: string,
  now = new Date(),
): boolean {
  const dateKey = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;

  const { dateKey: todayKey, minutes: nowMinutes } = getIstDateAndMinutes(now);
  if (dateKey !== todayKey) return false;

  const slotMinutes = parseHourlySlotToMinutes(slot);
  if (slotMinutes == null) return false;
  return slotMinutes < nowMinutes + BOOK_NOW_MIN_LEAD_TIME_MINUTES;
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
) {
  const trimmed = normalizeBookNowSlotLabel(anchor);
  if (!trimmed) return;

  occupiedBookingAnchors.add(trimmed);
  for (const slot of expandBlockedSlotsFromAnchor(trimmed)) {
    occupiedTimeStarts.add(slot);
    occupiedTimeSlots.add(deriveBookNowTimeSlot(slot));
  }
}

export async function getOccupiedBookNowSlots(
  date: string,
  city: string,
): Promise<BookNowOccupiedSlots> {
  const range = bookingDateRange(date);
  const cityFilter = buildCityFilter(city);
  if (!range || !cityFilter) {
    return { occupiedTimeStarts: [], occupiedTimeSlots: [], occupiedBookingAnchors: [] };
  }

  const orders = await BookingOrder.find({
    scheduledDate: { $gte: range.start, $lte: range.end },
    'address.city': cityFilter,
    status: { $in: BLOCKING_STATUSES },
  })
    .select('status scheduledTimeStart timeSlot')
    .lean();

  const occupiedTimeStarts = new Set<string>();
  const occupiedTimeSlots = new Set<BookNowTimeBucket>();
  const occupiedBookingAnchors = new Set<string>();

  for (const order of orders) {
    const start = String(order.scheduledTimeStart || '').trim();
    if (start) {
      addAnchorToOccupied(start, occupiedTimeStarts, occupiedTimeSlots, occupiedBookingAnchors);
      continue;
    }

    const bucket = order.timeSlot;
    if (bucket) {
      addAnchorToOccupied(
        bucketAnchorSlot(bucket),
        occupiedTimeStarts,
        occupiedTimeSlots,
        occupiedBookingAnchors,
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

function isAnchorBlocked(
  candidateAnchor: string,
  occupiedBookingAnchors: string[],
): boolean {
  return occupiedBookingAnchors.some((existing) =>
    bookNowSlotWindowsOverlap(existing, candidateAnchor),
  );
}

export async function assertBookNowSlotAvailable(params: {
  date?: string;
  city: string;
  scheduledTimeStart?: string;
  timeSlot?: BookNowTimeBucket;
}): Promise<void> {
  const date = String(params.date || '').trim();
  const city = normalizeCity(params.city);
  const scheduledTimeStart = String(params.scheduledTimeStart || '').trim();
  const timeSlot = params.timeSlot;

  if (!date || !city) return;

  if (scheduledTimeStart && isBookNowSlotWithinLeadTime(scheduledTimeStart, date)) {
    throw new Error('SLOT_TOO_SOON');
  }

  const occupied = await getOccupiedBookNowSlots(date, city);
  const anchors = occupied.occupiedBookingAnchors;
  const hasExactStartSlot = Boolean(scheduledTimeStart);

  if (scheduledTimeStart && isAnchorBlocked(scheduledTimeStart, anchors)) {
    throw new Error('SLOT_UNAVAILABLE');
  }

  /**
   * `timeSlot` is a coarse fallback bucket for legacy clients.
   * When exact `scheduledTimeStart` is provided, do not re-validate by bucket anchor;
   * that can incorrectly reject valid later slots in the same bucket.
   */
  if (!hasExactStartSlot && timeSlot) {
    const bucketAnchor = bucketAnchorSlot(timeSlot);
    if (isBookNowSlotWithinLeadTime(bucketAnchor, date)) {
      throw new Error('SLOT_TOO_SOON');
    }
    if (isAnchorBlocked(bucketAnchor, anchors)) {
      throw new Error('SLOT_UNAVAILABLE');
    }
  }
}
