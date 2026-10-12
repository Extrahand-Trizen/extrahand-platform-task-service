import { BadRequestError } from '../errors/AppError';

/**
 * Fields a requester may change through PUT /tasks/:id. Everything else (status, people, payment,
 * booking links, recurring plan/visit state, timestamps) is server-owned and only changes through
 * dedicated flows (accept, cancel, reschedule, recurring endpoints, Book Now bookings).
 */
export const REQUESTER_EDITABLE_TASK_FIELDS = [
  'title',
  'description',
  'category',
  'categoryLabel',
  'categorySlug',
  'subcategory',
  'requirements',
  'tags',
  'images',
  'priority',
  'urgency',
  'location',
  'taskArea',
  'remotely',
  'dateOption',
  'scheduledDate',
  'scheduledTimeStart',
  'scheduledTimeEnd',
  'timeSlot',
  'estimatedDuration',
  'flexibility',
  'budget',
  'budgetType',
  'isNegotiable',
  'recurring',
  'pickDropDetails',
  'medicinePickupDetails',
  'groceryPickupDetails',
  'packersMoversDetails',
] as const;

const EDITABLE = new Set<string>(REQUESTER_EDITABLE_TASK_FIELDS);
const PRICE_FIELDS = ['budget', 'budgetType', 'isNegotiable'] as const;
const SCHEDULE_FIELDS = ['scheduledDate', 'scheduledTimeStart', 'scheduledTimeEnd', 'timeSlot', 'dateOption'] as const;
const RECURRING_KEYS = ['enabled', 'frequency', 'startDate', 'endDate'] as const;

export interface TaskUpdateContext {
  status?: string;
  bookingSource?: string;
  budget?: { amount?: number; type?: string } | null;
  recurringPlanStatus?: string | null;
  scheduledDate?: Date | string | null;
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;
  timeSlot?: string | null;
  dateOption?: string | null;
}

export interface SanitizedTaskUpdate {
  update: Record<string, unknown>;
  dropped: string[];
}

function hasOperatorKeys(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (key.startsWith('$') || key.includes('.')) return true;
    if (hasOperatorKeys((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

function sameScheduleValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const da = new Date(a as string);
  const db = new Date(b as string);
  if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime()) && typeof a !== 'number') {
    return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
  }
  return String(a) === String(b);
}

function normalizeBudget(raw: unknown): { amount: number; currency: string; type: 'fixed' | 'hourly' } {
  if (raw === null || typeof raw !== 'object') {
    const amount = Number.parseFloat(String(raw));
    return { amount: Number.isFinite(amount) ? amount : 0, currency: 'INR', type: 'fixed' };
  }
  const obj = raw as Record<string, unknown>;
  const amount = Number(obj.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestError('Budget amount must be a non-negative number');
  }
  const type = obj.type === 'hourly' ? 'hourly' : 'fixed';
  return { amount, currency: 'INR', type };
}

/**
 * Reduce a requester's PUT /tasks/:id body to editable fields and enforce the state rules:
 * - price fields change only while the task is open and never on Book Now bookings;
 * - Book Now schedules change only through the booking reschedule flow;
 * - recurring settings change only before a plan is activated.
 * Unchanged values for locked fields are dropped silently so existing edit screens keep working.
 */
export function sanitizeRequesterTaskUpdate(
  current: TaskUpdateContext,
  updates: Record<string, unknown> | null | undefined,
): SanitizedTaskUpdate {
  const update: Record<string, unknown> = {};
  const dropped: string[] = [];
  if (!updates || typeof updates !== 'object') return { update, dropped };

  for (const [key, value] of Object.entries(updates)) {
    if (!EDITABLE.has(key)) {
      dropped.push(key);
      continue;
    }
    if (value !== null && typeof value === 'object' && hasOperatorKeys(value)) {
      throw new BadRequestError(`Invalid value for ${key}`);
    }
    update[key] = value;
  }

  const status = String(current.status || '').toLowerCase();
  const isBookNow = current.bookingSource === 'book_now';
  const planStatus = String(current.recurringPlanStatus || '').toLowerCase();
  const planLocked = planStatus === 'active' || planStatus === 'paused' || planStatus === 'ended';

  if (update.budget !== undefined) {
    const budget = normalizeBudget(update.budget);
    const currentAmount = Number(current.budget?.amount ?? 0);
    const priceLocked = isBookNow || status !== 'open' || planLocked;
    if (priceLocked) {
      if (budget.amount !== currentAmount) {
        throw new BadRequestError(
          isBookNow
            ? 'Book Now prices are set by ExtraHand and cannot be edited.'
            : 'The budget can only be changed while the task is open.',
        );
      }
      delete update.budget;
    } else {
      update.budget = budget;
    }
  }
  if (isBookNow || status !== 'open' || planLocked) {
    for (const field of PRICE_FIELDS) {
      if (field !== 'budget' && update[field] !== undefined) {
        delete update[field];
        dropped.push(field);
      }
    }
  }

  if (isBookNow) {
    for (const field of SCHEDULE_FIELDS) {
      if (update[field] === undefined) continue;
      if (!sameScheduleValue(update[field], current[field])) {
        throw new BadRequestError('Use Reschedule to change the time of a Book Now booking.');
      }
      delete update[field];
    }
  }

  if (update.recurring !== undefined) {
    if (isBookNow || planLocked || (status && status !== 'open')) {
      delete update.recurring;
      dropped.push('recurring');
    } else if (update.recurring === null || typeof update.recurring !== 'object') {
      delete update.recurring;
      dropped.push('recurring');
    } else {
      const src = update.recurring as Record<string, unknown>;
      const clean: Record<string, unknown> = {};
      for (const key of RECURRING_KEYS) {
        if (src[key] !== undefined) clean[key] = src[key];
      }
      update.recurring = clean;
    }
  }

  return { update, dropped };
}
