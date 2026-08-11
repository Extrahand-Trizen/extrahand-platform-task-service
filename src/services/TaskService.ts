import mongoose from "mongoose";
import Task, { ITask } from "../models/Task";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ServiceUnavailableError,
} from "../errors/AppError";
import logger from "../config/logger";
import { TaskCategory, TaskStatus } from "../types";
import { NotificationClient } from "./NotificationClient";
import { EmailServiceClient } from "../clients/EmailServiceClient";
import { InAppNotificationClient } from "../clients/InAppNotificationClient";
import { fireWhatsAppNotify } from "../clients/WhatsAppClient";
import { fireDialogWhatsAppForUser } from "../clients/fireDialogWhatsAppForUser";
import { buildScheduleVersion } from "../utils/workSchedule";
import { taskOpenAppButton } from "../utils/whatsappTaskButtons";
import TaskApplication from "../models/TaskApplication";
import TaskQuestion from "../models/TaskQuestion";
import TaskFollow from "../models/TaskFollow";
import TaskReport from "../models/TaskReport";
import BookingOrder from "../models/BookingOrder";
import { PaymentClient } from "./PaymentClient";
import { config } from "../config/env";
import { emitTaskStatusChanged } from '../socket/socketHandlers';
import { getRedisClient, REDIS_TTLS } from '../config/redis';
import { notifyPosterOnTaskCompleted, resolveTaskParticipantUids } from "./taskCompletionPosterNotify";
import { acceptsPosterDummyStartOtp } from '../utils/startOtpBypass';
import { getMeaningfulTextError } from '../utils/textValidation';
import { isActiveEscrow } from '../utils/taskCommitment';
import { RecurringVisitService } from './RecurringVisitService';
import { getVisitsForPlan, findVisitForPlan } from './RecurringVisitPlanStore';
import { schedulePostCreateNotifications } from './taskPostCreateNotifications';
import { notifyHelperRevisionRequested } from './revisionRequestedNotifications';
import { isBookNowTaskForCompletion } from '../utils/isBookNowTaskForCompletion';
import { assertMongoObjectIdTaskId } from '../utils/isMongoObjectId';
import { assertBookNowRaiseIssueAllowed } from '../utils/bookNowRaiseIssueWindow';
import { BOOK_NOW_PARTNER_PAYOUT_COPY } from '../constants/bookNowPartnerPayoutCopy';
import { buildCreateTaskApiResponse } from '../utils/buildCreateTaskApiResponse';
import { applyTaskAreaToLocation } from '../utils/resolveTaskArea';
import { enforcesOneTimePosterBudgetFormEdit, taskHasPickDropDetails } from '../utils/posterBudgetEditRules';
import { parseIncomingCalendarDate } from '../utils/recurringVisitScheduleBuilder';
import { isRecurringVisitPlanTask } from '../utils/recurringVisitMeta';
import {
  MY_TASKS_LIST_SELECT,
  buildApplicationPreviewsForTasks,
  buildRecurringSummary,
  parseMyTasksInclude,
  truncateDescription,
} from './myTasksEnrichment';

// Helper function to map frontend category values to backend enum values
function mapCategoryToEnum(frontendCategory: string | undefined): TaskCategory {
  if (!frontendCategory) return "other";

  const categoryMap: Record<string, TaskCategory> = {
    // Exact matches
    cleaning: "cleaning",
    repair: "repair",
    delivery: "delivery",
    assembly: "assembly",
    gardening: "gardening",
    petcare: "petcare",
    other: "other",

    // Frontend variations to backend enum
    Cleaning: "cleaning",
    Repair: "repair",
    Delivery: "delivery",
    Assembly: "assembly",
    Gardening: "gardening",
    "Pet Care": "petcare",
    Petcare: "petcare",
    Other: "other",

    // Common variations
    "Home Services": "other",
    "Home Cleaning": "cleaning",
    "House Cleaning": "cleaning",
    Plumbing: "repair",
    Electrical: "repair",
    Carpentry: "repair",
    Moving: "delivery",
    Transport: "delivery",
    "Furniture Assembly": "assembly",
    "IKEA Assembly": "assembly",
    "Garden Maintenance": "gardening",
    "Pet Sitting": "petcare",
    "Dog Walking": "petcare",
    General: "other",
    Miscellaneous: "other",

    // Frontend category slugs
    "home-cleaning": "cleaning",
    "deep-cleaning": "cleaning",
    plumbing: "repair",
    "water-tanker-services": "delivery",
    electrical: "repair",
    carpenter: "repair",
    painting: "repair",
    "ac-repair": "repair",
    "appliance-repair": "repair",
    "pest-control": "repair",
    "car-washing": "cleaning",
    "roadside-assistance": "repair",
    maid: "cleaning",
    "personal-assistance": "other",
    "Roadside Assistance": "repair",
    Maid: "cleaning",
    "Personal Assistance": "other",
    // Book Now Hourly Helper (catalog slug / mistaken SKU taskCategory)
    helper: "other",
    "hourly-helper": "other",
    handyperson: "repair",
    "furniture-assembly": "assembly",
    "security-patrol": "other",
    "beauty-services": "other",
    "massage-spa": "other",
    "fitness-trainers": "other",
    tutors: "other",
    "it-support": "repair",
    "photographer-videographer": "other",
    "event-services": "other",
    "pet-services": "petcare",
    "driver-chauffeur": "delivery",
    "cooking-home-chef": "other",
    "laundry-ironing": "cleaning",
    "senior-care-elder-care": "other",

    // Post-a-task grouped categories (web app)
    "it-computer-support": "repair",
    "repair-maintenance": "repair",
    design: "other",
    events: "other",
    "personal-lifestyle": "other",
    "care-services": "other",
    "education-training": "other",
    "professional-services": "other",

    // Packers & Movers
    "packers-movers": "packers-movers",
    "Packers & Movers": "packers-movers",
    "packers-and-movers": "packers-movers",
    "home-shifting": "packers-movers",
    "office-relocation": "packers-movers",
    moving: "packers-movers",
    relocation: "packers-movers",

    // Delivery / Pickup subcategories
    "delivery-pickup-services": "delivery",
    "grocery-pickup": "delivery",
    "medicine-pickup": "delivery",
    "pick-drop": "delivery",
    "pick-and-drop": "delivery",
    "Grocery Pickup": "delivery",
    "Medicine Pickup": "delivery",
    "Pick & Drop": "delivery",
  };

  // Try exact match first, then case-insensitive match
  const normalizedCategory = frontendCategory.toString().toLowerCase().trim();

  // Check exact match
  if (categoryMap[frontendCategory]) {
    return categoryMap[frontendCategory];
  }

  // Check normalized match
  if (categoryMap[normalizedCategory]) {
    return categoryMap[normalizedCategory];
  }

  // Check if it contains any of our keywords
  for (const [key, value] of Object.entries(categoryMap)) {
    if (
      normalizedCategory.includes(key.toLowerCase()) ||
      key.toLowerCase().includes(normalizedCategory)
    ) {
      return value;
    }
  }

  // Default fallback
  logger.warn(
    `âš ï¸ Unknown category: "${frontendCategory}", defaulting to "other"`
  );
  return "other";
}

function hasOpenInStatusFilter(
  status?: TaskStatus | TaskStatus[] | string | string[],
): boolean {
  if (!status) return false;
  if (Array.isArray(status)) return status.includes("open");
  return status === "open";
}

function buildLiveOpenExpiryClause(now: Date): any {
  return {
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: now } },
    ],
  };
}

function normalizeDateOnly(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildScheduleDates(params: {
  startDate: Date;
  endDate: Date;
  frequency: "daily" | "weekly" | "custom";
  maxOccurrences: number;
}): Date[] {
  const { startDate, endDate, frequency, maxOccurrences } = params;
  const dates: Date[] = [];
  const stepDays = frequency === "weekly" ? 7 : 1;

  let current = normalizeDateOnly(startDate);
  const last = normalizeDateOnly(endDate);

  while (current.getTime() <= last.getTime()) {
    dates.push(new Date(current));
    if (dates.length >= maxOccurrences) break;
    const next = new Date(current);
    next.setDate(next.getDate() + stepDays);
    current = next;
  }

  return dates;
}

// Pagination caps for Atlas M0 safety (avoid large skip() and unbounded list size)
const MAX_LIMIT = 50;
const MAX_PAGE = 100;

// Minimal fields for task list responses (omit long description and heavy arrays)
const TASK_LIST_SELECT =
  'title category categorySlug categoryLabel subcategory budget isNegotiable location status urgency priority requesterId assigneeId assignedAt views isFeatured expiresAt scheduledDate dateOption timeSlot flexibility createdAt updatedAt packersMoversDetails groceryPickupDetails medicinePickupDetails pickDropDetails images bookingSource bookingOrderId parentTaskId recurringVisitId recurring recurringPlan activeVisitId tags posterBudgetEditedViaFormOnce';

/** Post & Choose only â€” Book Now tasks are assigned via ops, not helper browse. */
function buildMarketplaceBrowseClause(): Record<string, unknown> {
  return {
    $and: [
      {
        $or: [
          { bookingSource: { $exists: false } },
          { bookingSource: 'marketplace' },
        ],
      },
      {
        $or: [
          { bookingOrderId: { $exists: false } },
          { bookingOrderId: null },
          { bookingOrderId: '' },
        ],
      },
    ],
  };
}

/** Browse lists show parent plans only — not per-visit child tasks. */
function buildMarketplaceParentOnlyClause(): Record<string, unknown> {
  return {
    $or: [{ parentTaskId: { $exists: false } }, { parentTaskId: null }],
  };
}

/** Geospatial filter for nearby browse ($geoWithin works with createdAt sort; $near does not). */
function buildNearbyLocationClause(
  lng: number,
  lat: number,
  radiusKm: number,
): Record<string, unknown> {
  const radiusRadians = radiusKm / 6378.1;
  return {
    $or: [
      {
        'location.coordinates': {
          $geoWithin: {
            $centerSphere: [[lng, lat], radiusRadians],
          },
        },
      },
      { 'location.coordinates.0': { $exists: false } },
      { location: { $exists: false } },
    ],
  };
}

const START_OTP_MAX_ATTEMPTS = 5;

function generateStartOtpCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function getPendingAdditionalQuoteRequest(task: ITask): any | null {
  const requests = Array.isArray((task as any)?.additionalQuoteRequests)
    ? ((task as any).additionalQuoteRequests as any[])
    : [];
  return requests.find((request) => request?.status === "pending") || null;
}

export class TaskService {
  /**
   * Get all tasks with optional filtering
   */
  static async getTasks(filters: {
    status?: TaskStatus | TaskStatus[] | string | string[];
    excludeOverdue?: boolean | string;
    category?: TaskCategory | string | string[];
    city?: string;
    minBudget?: number;
    maxBudget?: number;
    search?: string;
    suburb?: string;
    remotely?: boolean | null;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    excludeRequesterId?: string;
    assigneeId?: string;
    posterUid?: string;
    requesterId?: string;
    bookingSource?: string;
    /**
     * Server-side Book Now visibility guard (partner category ∩ work areas).
     * Only applied when bookingSource === 'book_now'.
     */
    partnerVisibilityFilter?: Record<string, any> | null;
    /** When true the requesting end user may not see ANY Book Now pool jobs. */
    partnerVisibilityBlocked?: boolean;
    limit?: number;
    page?: number;
  }): Promise<{ tasks: ITask[]; pagination: any }> {
    const { status, excludeOverdue, category, city, minBudget, maxBudget, search, suburb, remotely, sortBy, sortOrder, excludeRequesterId, assigneeId, posterUid, requesterId, bookingSource, partnerVisibilityFilter, partnerVisibilityBlocked, limit = 50, page = 1 } = filters;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, page), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;

    // End users explicitly requesting the Book Now pool who cannot be resolved
    // to a qualifying partner see no Book Now jobs at all.
    if (partnerVisibilityBlocked) {
      return {
        tasks: [],
        pagination: {
          page: effectivePage,
          limit: effectiveLimit,
          total: 0,
          pages: 0,
        },
      };
    }

    // Determine if this request is eligible for Redis caching (discover list shape)
    const hasCategory =
      Array.isArray(category) ? category.length > 0 : !!category;
    const hasBudgetFilter =
      typeof minBudget === "number" || typeof maxBudget === "number";
    const hasSearchOrSuburb = !!search || !!suburb;
    const hasRemotelyFilter = typeof remotely === "boolean";
    const hasUserSpecificFilter =
      !!excludeRequesterId || !!assigneeId || !!posterUid || !!requesterId;
    const hasNonDefaultSort =
      !!sortBy && sortBy !== "recent";

    const isCacheable =
      (status === "open" || (Array.isArray(status) && status.length === 1 && status[0] === "open")) &&
      !bookingSource &&
      !(excludeOverdue === true || excludeOverdue === 'true') &&
      !hasCategory &&
      !city &&
      !hasBudgetFilter &&
      !hasSearchOrSuburb &&
      !hasRemotelyFilter &&
      !hasUserSpecificFilter &&
      !hasNonDefaultSort &&
      effectiveLimit === 20 &&
      effectivePage >= 1 &&
      effectivePage <= 3;

    let cacheKey: string | null = null;

    if (isCacheable) {
      cacheKey = `tasks:list:open:marketplace:v2:p${effectivePage}:20`;

      try {
        const redis = getRedisClient();
        if (redis && cacheKey) {
          const cached = await redis.get(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as {
              tasks: ITask[];
              pagination: any;
            };
            logger.debug("Task list cache HIT", {
              key: cacheKey,
              page: effectivePage,
              taskCount: parsed.tasks.length,
            });
            return parsed;
          }
          logger.debug("Task list cache MISS", { key: cacheKey, page: effectivePage });
        }
      } catch (err) {
        logger.error("Redis get error for task list cache", {
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Build filters using $and to safely compose multiple $or filters
    const andClauses: any[] = [];

    // When bookingSource is explicitly specified (admin view), skip the marketplace-only
    // clause so book_now tasks are visible. Otherwise apply it to protect helper browse.
    if (bookingSource && bookingSource !== 'all') {
      // Admin requested a specific booking source — filter directly by bookingSource
      if (bookingSource === 'book_now') {
        const bookNowClauses: any[] = [{ bookingSource: 'book_now' }];
        // Partner visibility guard: end users only receive Book Now jobs that
        // match their registered service categories AND their selected work
        // areas — enforced inside the query itself.
        if (partnerVisibilityFilter) {
          bookNowClauses.push(partnerVisibilityFilter);
        }
        andClauses.push({ $and: bookNowClauses });
      } else if (bookingSource === 'posted_task' || bookingSource === 'marketplace') {
        // Posted tasks: no bookingSource field, or marketplace
        andClauses.push({
          $or: [
            { bookingSource: { $exists: false } },
            { bookingSource: 'marketplace' },
          ],
        });
      }
    } else {
      // Book Now tasks are not marketplace listings — hide from helper browse/discover.
      andClauses.push(buildMarketplaceBrowseClause());
      andClauses.push(buildMarketplaceParentOnlyClause());
    }

    // Status filter: support single value or array (e.g. "open,assigned" sent as array)
    if (status) {
      if (status === 'overdue') {
        // scheduledDate is stored as UTC midnight for a calendar day — compare
        // against start of today (UTC), not wall-clock now, or "today" is overdue
        // as soon as the morning starts in IST.
        const startOfTodayUtc = normalizeDateOnly(new Date());
        andClauses.push({ status: 'open' });
        andClauses.push({ scheduledDate: { $lt: startOfTodayUtc } });
        andClauses.push({ dateOption: { $ne: 'flexible' } });
      } else if (status === 'open' && (excludeOverdue === true || excludeOverdue === 'true')) {
        const startOfTodayUtc = normalizeDateOnly(new Date());
        andClauses.push({ status: 'open' });
        andClauses.push({
          $or: [
            { scheduledDate: { $exists: false } },
            { scheduledDate: null },
            { dateOption: 'flexible' },
            { scheduledDate: { $gte: startOfTodayUtc } },
          ],
        });
      } else {
        if (Array.isArray(status) && status.length > 1) {
          andClauses.push({ status: { $in: status } });
        } else if (Array.isArray(status) && status.length === 1) {
          andClauses.push({ status: status[0] });
        } else if (typeof status === 'string') {
          andClauses.push({ status });
        }
      }
    }
    // Browse tasks should hide deadline-crossed open tasks at query time.
    if (hasOpenInStatusFilter(status)) {
      andClauses.push(buildLiveOpenExpiryClause(new Date()));
    }

    if (excludeRequesterId && mongoose.Types.ObjectId.isValid(excludeRequesterId)) {
      andClauses.push({ requesterId: { $ne: new mongoose.Types.ObjectId(excludeRequesterId) } });
    }

    // Filter by assignee ID (for completed task stats)
    if (assigneeId && mongoose.Types.ObjectId.isValid(assigneeId)) {
      andClauses.push({ assigneeId: new mongoose.Types.ObjectId(assigneeId) });
    }

    // Filter by requester profile ID (customer "my tasks" style lists)
    if (requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
      andClauses.push({ requesterId: new mongoose.Types.ObjectId(requesterId) });
      andClauses.push({ isDeletedByCustomer: { $ne: true } });
    }

    // Filter by poster UID (for posted tasks)
    if (posterUid) {
      andClauses.push({ posterUid: posterUid });
      andClauses.push({ isDeletedByCustomer: { $ne: true } });
    }

    // Support multi-category (comma separated from query) or single category mapping
    if (category) {
      if (Array.isArray(category)) {
        const mapped = category.map((c) => mapCategoryToEnum(c));
        andClauses.push({ category: { $in: mapped } });
      } else {
        andClauses.push({ category: mapCategoryToEnum(category as string) });
      }
    }

    if (city) andClauses.push({ 'location.city': city });

    // Budget filters
    if (typeof minBudget === 'number' || typeof maxBudget === 'number') {
      const budgetFilter: any = {};
      if (typeof minBudget === 'number') budgetFilter.$gte = minBudget;
      if (typeof maxBudget === 'number') budgetFilter.$lte = maxBudget;
      andClauses.push({ 'budget.amount': budgetFilter });
    }

    // Suburb filter (match address or city)
    if (suburb) {
      const escaped = suburb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, 'i');
      andClauses.push({ $or: [{ 'location.address': re }, { 'location.city': re }] });
    }

    // Remotely / In-person filters
    if (typeof remotely === 'boolean') {
      if (remotely === true) {
        // Remote tasks: tasks without coordinates/address
        andClauses.push({ $or: [{ location: { $exists: false } }, { 'location.coordinates.0': { $exists: false } }, { 'location.address': { $exists: false } }] });
      }
      // remotely === false: in-person filter â€” don't strictly exclude tasks without coordinates
      // to avoid hiding packers-movers and similar category-specific tasks
    }

    // Search across title, description, city and category
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, 'i');
      andClauses.push({
        $or: [
          { title: re },
          { description: re },
          { 'location.city': re },
          { category: re },
        ]
      });
    }

    const query = andClauses.length > 0 ? { $and: andClauses } : {};

    // Sorting
    const direction = sortOrder === 'asc' ? 1 : -1;
    let sortObj: any = { createdAt: -1 }; // default: recent
    if (sortBy) {
      if (sortBy === 'price-low') sortObj = { 'budget.amount': 1 };
      else if (sortBy === 'price-high') sortObj = { 'budget.amount': -1 };
      else if (sortBy === 'date') sortObj = { createdAt: direction };
      else if (sortBy === 'scheduledDate' || sortBy === 'dueDate') sortObj = { scheduledDate: direction };
      else sortObj = { createdAt: direction };
    }

    const tasks = await Task.find(query)
      .select(TASK_LIST_SELECT)
      .sort(sortObj)
      .skip(skip)
      .limit(effectiveLimit)
      .lean();

    const total = await Task.countDocuments(query);

    const result = {
      tasks: tasks as unknown as ITask[],
      pagination: {
        page: effectivePage,
        limit: effectiveLimit,
        total,
        pages: Math.ceil(total / effectiveLimit),
      },
    };

    if (cacheKey) {
      try {
        const redis = getRedisClient();
        if (redis) {
          await redis.set(cacheKey, JSON.stringify(result), {
            EX: REDIS_TTLS.TASK_LIST_SECONDS,
          });
          logger.info("Task list cache SET", {
            key: cacheKey,
            page: effectivePage,
            taskCount: result.tasks.length,
            ttlSeconds: REDIS_TTLS.TASK_LIST_SECONDS,
          });
        }
      } catch (err) {
        logger.error("Redis set error for task list cache", {
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return result;
  }

  /**
   * Get nearby tasks using geospatial query
   */
  static async getNearbyTasks(params: {
    lat: number;
    lng: number;
    radiusKm?: number;
    limit?: number;
    page?: number;
    status?: TaskStatus | TaskStatus[] | string | string[];
    category?: TaskCategory | string | string[];
    city?: string;
    minBudget?: number;
    maxBudget?: number;
    search?: string;
    suburb?: string;
    remotely?: boolean | null;
    sortBy?: string;
    excludeRequesterId?: string;
    assigneeId?: string;
    posterUid?: string;
  }): Promise<{ tasks: ITask[]; pagination: any; location: any }> {
    const {
      lat,
      lng,
      radiusKm = 10,
      limit = 50,
      page = 1,
      status = "open",
      category,
      city,
      minBudget,
      maxBudget,
      search,
      suburb,
      remotely,
      sortBy,
      excludeRequesterId,
      assigneeId,
      posterUid,
    } = params;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestError("Invalid latitude/longitude");
    }
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, page), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;

    const andClauses: any[] = [];

    // Book Now tasks are ops-assigned â€” exclude from helper browse/nearby.
    andClauses.push(buildMarketplaceBrowseClause());
    andClauses.push(buildMarketplaceParentOnlyClause());

    // Include nearby tasks (with coordinates) OR remote/packers-movers tasks (without coordinates)
    andClauses.push(buildNearbyLocationClause(lng, lat, radiusKm));

    // Status filter: support single value or array
    if (status) {
      if (Array.isArray(status) && status.length > 1) {
        andClauses.push({ status: { $in: status } });
      } else if (Array.isArray(status) && status.length === 1) {
        andClauses.push({ status: status[0] });
      } else if (typeof status === "string") {
        andClauses.push({ status });
      }
    }
    // Nearby browse should also hide deadline-crossed open tasks at query time.
    if (hasOpenInStatusFilter(status)) {
      andClauses.push(buildLiveOpenExpiryClause(new Date()));
    }

    if (excludeRequesterId && mongoose.Types.ObjectId.isValid(excludeRequesterId)) {
      andClauses.push({
        requesterId: { $ne: new mongoose.Types.ObjectId(excludeRequesterId) },
      });
    }

    if (assigneeId && mongoose.Types.ObjectId.isValid(assigneeId)) {
      andClauses.push({ assigneeId: new mongoose.Types.ObjectId(assigneeId) });
    }

    if (posterUid) {
      andClauses.push({ posterUid });
      andClauses.push({ isDeletedByCustomer: { $ne: true } });
    }

    if (category) {
      if (Array.isArray(category)) {
        const mapped = category.map((c) => mapCategoryToEnum(c));
        andClauses.push({ category: { $in: mapped } });
      } else {
        andClauses.push({ category: mapCategoryToEnum(category as string) });
      }
    }

    if (city) andClauses.push({ "location.city": city });

    if (typeof minBudget === "number" || typeof maxBudget === "number") {
      const budgetFilter: any = {};
      if (typeof minBudget === "number") budgetFilter.$gte = minBudget;
      if (typeof maxBudget === "number") budgetFilter.$lte = maxBudget;
      andClauses.push({ "budget.amount": budgetFilter });
    }

    if (suburb) {
      const escaped = suburb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "i");
      andClauses.push({ $or: [{ "location.address": re }, { "location.city": re }] });
    }

    if (typeof remotely === "boolean") {
      if (remotely === true) {
        // Remote-only: tasks without coordinates
        andClauses.push({
          $or: [
            { location: { $exists: false } },
            { "location.coordinates.0": { $exists: false } },
            { "location.address": { $exists: false } },
          ],
        });
      }
      // remotely === false: in-person filter â€” but still include packers-movers (no coordinates)
      // We don't add a strict coordinates-required filter to avoid hiding packers-movers
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "i");
      andClauses.push({
        $or: [{ title: re }, { description: re }, { "location.city": re }, { category: re }],
      });
    }

    let sortObj: any = { createdAt: -1 };
    if (sortBy) {
      if (sortBy === "price-low") sortObj = { "budget.amount": 1 };
      else if (sortBy === "price-high") sortObj = { "budget.amount": -1 };
      else if (sortBy === "date") sortObj = { createdAt: 1 };
    }

    const query = andClauses.length > 0 ? { $and: andClauses } : {};

    const tasks = await Task.find(query)
      .select(TASK_LIST_SELECT)
      .skip(skip)
      .limit(effectiveLimit)
      .sort(sortObj)
      .lean();

    const total = await Task.countDocuments(query);

    return {
      tasks: tasks as unknown as ITask[],
      pagination: {
        page: effectivePage,
        limit: effectiveLimit,
        total,
        totalPages: Math.ceil(total / effectiveLimit),
      },
      location: {
        latitude: lat,
        longitude: lng,
        radiusKm,
      },
    };
  }

  /**
   * Get tasks posted by a user
   */
  static async getMyTasks(
    profileId: mongoose.Types.ObjectId,
    filters: {
      status?: TaskStatus;
      limit?: number;
      page?: number;
      include?: string;
    }
  ): Promise<{ tasks: ITask[]; pagination: any }> {
    const { status, limit = 50, page = 1, include } = filters;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, page), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;
    const includeFlags = parseMyTasksInclude(include);

    const query: any = {
      requesterId: profileId,
      $or: [{ parentTaskId: { $exists: false } }, { parentTaskId: null }],
      isDeletedByCustomer: { $ne: true },
    };
    if (status) query.status = status;

    const tasks = await Task.find(query)
      .select(MY_TASKS_LIST_SELECT)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(effectiveLimit)
      .lean();

    const total = await Task.countDocuments(query);

    let enrichedTasks = tasks.map((task) => {
      const row = task as Record<string, unknown>;
      if (typeof row.description === 'string') {
        row.description = truncateDescription(row.description);
      }
      return row;
    });

    if (includeFlags.applicationPreview && enrichedTasks.length > 0) {
      const previewMap = await buildApplicationPreviewsForTasks(
        enrichedTasks as Array<{ _id?: mongoose.Types.ObjectId | string; status?: string }>,
      );
      enrichedTasks = enrichedTasks.map((task) => {
        const row = task as Record<string, unknown>;
        const preview = previewMap.get(String(row._id));
        if (preview) {
          row.applicationPreview = preview;
        }
        return row;
      });
    }

    if (includeFlags.recurringSummary && enrichedTasks.length > 0) {
      enrichedTasks = enrichedTasks.map((task) => {
        const row = task as Record<string, unknown>;
        const summary = buildRecurringSummary(row);
        if (summary) {
          row.recurringSummary = summary;
        }
        return row;
      });
    }

    return {
      tasks: enrichedTasks as unknown as ITask[],
      pagination: {
        page: effectivePage,
        limit: effectiveLimit,
        total,
        pages: Math.ceil(total / effectiveLimit),
      },
    };
  }

  /**
   * Fast count for open tasks by requester profile id.
   */
  static async getOpenTaskCountByRequesterId(requesterId: string): Promise<number> {
    if (!mongoose.Types.ObjectId.isValid(requesterId)) {
      throw new BadRequestError("Invalid requesterId");
    }

    return Task.countDocuments({
      requesterId: new mongoose.Types.ObjectId(requesterId),
      status: "open",
      isDeletedByCustomer: { $ne: true },
      ...buildLiveOpenExpiryClause(new Date()),
    });
  }

  /**
   * Get a single task by ID (with Redis cache to reduce DB load under concurrency)
   */
  static async getTaskById(taskId: string): Promise<ITask> {
    // Avoid Mongoose CastError 500s for Book Now escrow placeholders (`booknow-pending-*`).
    assertMongoObjectIdTaskId(taskId);

    const cacheKey = `task:detail:${taskId}`;
    let cachedTask: ITask | null = null;

    try {
      const redis = getRedisClient();
      if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          cachedTask = JSON.parse(cached) as ITask;
          logger.debug("Task detail cache HIT", { taskId });
        }
      }
    } catch (err) {
      logger.warn("Task detail cache read error", { taskId, error: err instanceof Error ? err.message : String(err) });
    }

    if (cachedTask) {
      const stillExists = await Task.findById(taskId).select('_id').lean();
      if (!stillExists) {
        TaskService.invalidateTaskCache(taskId);
        cachedTask = null;
      }
    }

    let task =
      cachedTask ??
      ((await Task.findById(taskId).lean()) as unknown as ITask | null);

    if (!task) {
      const recovered = await RecurringVisitService.resolveDeletedRecurringChildTaskAccess(
        taskId,
      );
      if (recovered) {
        TaskService.invalidateTaskCache(taskId);
        task = recovered as unknown as ITask;
      }
    }

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Book Now must never linger in `review` after proof — heal stale rows from older deploys.
    if (
      isBookNowTaskForCompletion(task) &&
      String(task.status) === 'review' &&
      Array.isArray((task as { completionProof?: unknown[] }).completionProof) &&
      ((task as { completionProof?: unknown[] }).completionProof?.length || 0) > 0
    ) {
      try {
        const { CompletionService } = await import('./CompletionService');
        const healed = await CompletionService.healBookNowStuckInReview(taskId);
        if (healed) {
          task = healed as unknown as ITask;
        }
      } catch (healErr) {
        logger.warn('Book Now review→completed heal failed', {
          taskId,
          error: healErr instanceof Error ? healErr.message : String(healErr),
        });
      }
    }

    if (RecurringVisitService.isVisitPlanTask(task as unknown as Record<string, unknown>)) {
      const planDoc = await Task.findById(taskId);
      if (planDoc) {
        void RecurringVisitService.sanitizeOrphanedScheduleChildReferences(planDoc);
      }
      void RecurringVisitService.scheduleReconcilePlanState(taskId);

      const taskRecord = task as unknown as Record<string, unknown>;
      const embeddedSchedule = Array.isArray(task.schedule) ? task.schedule : [];
      const hasEmbeddedVisitRows = embeddedSchedule.some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { visitId?: string }).visitId === 'string',
      );
      if (!hasEmbeddedVisitRows) {
        const visits = await getVisitsForPlan(task);
        if (visits.length > 0) {
          taskRecord.schedule = visits;
        }
      }
    }

    const result = task as unknown as ITask;
    const resolvedTaskId = String((result as unknown as { _id?: unknown })._id ?? taskId);

    try {
      const redis = getRedisClient();
      if (redis) {
        const payload = JSON.stringify(result);
        if (resolvedTaskId === taskId) {
          await redis.setex(cacheKey, REDIS_TTLS.TASK_DETAIL_SECONDS, payload);
          logger.debug("Task detail cache SET", { taskId });
        } else {
          await redis.setex(
            `task:detail:${resolvedTaskId}`,
            REDIS_TTLS.TASK_DETAIL_SECONDS,
            payload,
          );
          logger.debug("Task detail cache SET for resolved recurring child", {
            requestedTaskId: taskId,
            resolvedTaskId,
          });
        }
      }
    } catch (err) {
      logger.warn("Task detail cache write error", { taskId, error: err instanceof Error ? err.message : String(err) });
    }

    return result;
  }

  /**
   * Invalidate cached task so next getTaskById fetches fresh from DB (call after update/delete).
   * Fire-and-forget — prefer `await invalidateTaskCacheAsync` when the client may refetch immediately.
   */
  static invalidateTaskCache(taskId: string): void {
    void TaskService.invalidateTaskCacheAsync(taskId);
  }

  /** Await Redis delete so a follow-up GET cannot return a stale detail payload. */
  static async invalidateTaskCacheAsync(taskId: string): Promise<void> {
    const cacheKey = `task:detail:${taskId}`;
    try {
      await getRedisClient()?.del(cacheKey);
    } catch (err: any) {
      logger.warn("Task detail cache invalidate error", {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Invalidate cached open-marketplace list pages so new posts appear in browse immediately. */
  static invalidateTaskListCache(): void {
    const redis = getRedisClient();
    if (!redis) return;
    const keys = [1, 2, 3].map((page) => `tasks:list:open:marketplace:v2:p${page}:20`);
    Promise.all(keys.map((key) => redis.del(key))).catch((err: unknown) => {
      logger.warn("Task list cache invalidate error", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Create a new task
   */
  static async createTask(
    profileId: mongoose.Types.ObjectId,
    taskData: any,
    uid?: string // Firebase UID for notifications (actorId)
  ): Promise<ITask> {
    // Delivery/pickup tasks have system-generated titles and descriptions â€” skip meaningful-text checks
    const isDeliveryPickup = [taskData.category, taskData.categorySlug].some((c: string) =>
      String(c || '').toLowerCase().includes('delivery') ||
      String(c || '').toLowerCase().includes('pickup') ||
      String(c || '').toLowerCase().includes('pick-drop') ||
      String(c || '').toLowerCase().includes('pick_drop') ||
      String(c || '').toLowerCase().includes('packers') ||
      String(c || '').toLowerCase().includes('movers')
    );

    if (!isDeliveryPickup) {
      const titleError = getMeaningfulTextError(taskData.title, {
        fieldName: 'Title',
        minLength: 3,
        minWords: 2,
        allowSingleWord: true,
        minSingleWordLength: 4,
        minSingleWordVowelRatio: 0.25,
        minVowelRatio: 0.25,
      });
      if (titleError) {
        throw new BadRequestError(titleError);
      }

      const descriptionError = getMeaningfulTextError(taskData.description, {
        fieldName: 'Description',
        minLength: 10,
        minWords: 3,
        minVowelRatio: 0.25,
      });
      if (descriptionError) {
        throw new BadRequestError(descriptionError);
      }
    }

    logger.info(`[TaskService.createTask] Starting task creation`, {
      profileId: profileId.toString(),
      profileIdType: typeof profileId,
      isObjectId: profileId instanceof mongoose.Types.ObjectId,
      taskTitle: taskData.title,
      uid
    });

    // Map frontend category to backend enum
    const frontendCategory = taskData.category || taskData.type;
    const mappedCategory = mapCategoryToEnum(frontendCategory);
    const categorySlug = taskData.categorySlug || frontendCategory;
    const categoryLabel = taskData.categoryLabel;

    logger.debug(
      `ðŸ” Category mapping: "${frontendCategory}" â†’ "${mappedCategory}"`
    );

    // âŒ Removed requesterName handling - will be populated from Profile when needed

    // Handle budget - ensure it's an object matching the schema
    const budget = {
      amount:
        typeof taskData.budget === "object"
          ? taskData.budget.amount ?? 0
          : parseFloat(taskData.budget) || 0,
      currency: taskData.budget?.currency || "INR",
      type: taskData.budget?.type || taskData.budgetType || "fixed",
    };

    // Handle location - only include if provided
    let location;
    if (
      taskData.location &&
      (taskData.location.address || taskData.location.coordinates)
    ) {
      const coords = taskData.location.coordinates ||
        (taskData.location.longitude && taskData.location.latitude
          ? [taskData.location.longitude, taskData.location.latitude]
          : null);

      location = applyTaskAreaToLocation(
        {
          type: "Point" as const,
          // Only set coordinates if we have valid non-zero values
          ...(coords && coords[0] !== 0 && coords[1] !== 0 ? { coordinates: coords } : {}),
          address: taskData.location.address || taskData.location || undefined,
          city: taskData.location.city || taskData.city || undefined,
          state: taskData.location.state || taskData.state || undefined,
          pinCode: taskData.location.pinCode || taskData.pinCode || undefined,
          country: taskData.location.country || taskData.country || "India",
          ...(taskData.location.taskArea
            ? { taskArea: String(taskData.location.taskArea).trim() }
            : {}),
        },
        {
          taskArea: taskData.location.taskArea,
          legacyTaskArea: taskData.taskArea,
        },
      );
    }

    const taskPayload: any = {
      title: taskData.title,
      description: taskData.description,
      category: mappedCategory,
      categorySlug: categorySlug,
      categoryLabel: categoryLabel,
      subcategory: taskData.subcategory,
      budget: budget,
      isNegotiable: taskData.isNegotiable || false,
      urgency: taskData.urgency || "medium",
      priority: taskData.priority || "normal",
      requesterId: profileId, // âœ… ObjectId reference
      // âŒ Removed requesterName - API Gateway will enrich with Profile data
      estimatedDuration: taskData.estimatedDuration || taskData.duration,
      scheduledDate: taskData.scheduledDate
        ? parseIncomingCalendarDate(taskData.scheduledDate)
        : undefined,
      scheduledTimeStart: taskData.scheduledTimeStart,
      scheduledTimeEnd: taskData.scheduledTimeEnd,
      dateOption: taskData.dateOption,
      timeSlot: taskData.timeSlot,
      flexibility: taskData.flexibility || "flexible",
      timeFlexibilityValue: taskData.timeFlexibilityValue,
      requirements: taskData.requirements || taskData.skillsRequired || [],
      images: taskData.images || [],
      tags: taskData.tags || [],
      expiresAt: taskData.expiresAt,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (taskPayload.scheduledDate) {
      taskPayload.notificationGovernance = {
        scheduleVersion: buildScheduleVersion({
          scheduledDate: taskPayload.scheduledDate,
          scheduledTimeStart: taskPayload.scheduledTimeStart,
          scheduledTimeEnd: taskPayload.scheduledTimeEnd,
        }),
      };
    }

    // DEBUG: Log images field received
    logger.debug(`[TaskService.createTask] images DEBUG`, {
      hasImagesInInput: !!taskData.images,
      inputImagesCount: taskData.images?.length || 0,
      inputImages: taskData.images,
      hasImagesInPayload: !!taskPayload.images,
      payloadImagesCount: taskPayload.images.length,
      payloadImages: taskPayload.images
    });

    const recurring = taskData.recurring;
    let createdVisitMeta: ReturnType<typeof RecurringVisitService.tryDecodeMetaFromTaskData> = null;
    let createdVisitStartDate: Date | undefined;
    let createdVisitEndDate: Date | undefined;

    if (recurring?.enabled) {
      const visitMeta = RecurringVisitService.tryDecodeMetaFromTaskData(
        taskData as Record<string, unknown>,
      );

      if (visitMeta) {
        createdVisitMeta = visitMeta;
        RecurringVisitService.applyPlanOnCreate(
          taskPayload as Record<string, unknown>,
          taskData as Record<string, unknown>,
          visitMeta,
        );

        const rawStart = recurring.startDate || taskData.scheduledDate;
        const startDate = rawStart
          ? parseIncomingCalendarDate(rawStart)
          : (taskPayload.scheduledDate as Date);
        const rawEnd = recurring.endDate;
        const endDate = rawEnd
          ? parseIncomingCalendarDate(rawEnd)
          : visitMeta.endType === 'end_on_date'
            ? (taskPayload.recurringPlan as { endDate?: Date })?.endDate
            : undefined;

        taskPayload.recurring = {
          enabled: true,
          frequency:
            visitMeta.pattern === 'daily'
              ? 'daily'
              : visitMeta.pattern === 'weekly' || visitMeta.pattern === 'biweekly'
                ? 'weekly'
                : 'custom',
          startDate,
          endDate,
          requireApproval: recurring.requireApproval !== false,
          minCommitment: recurring.minCommitment || undefined,
        };
        createdVisitStartDate = startDate;
        createdVisitEndDate = endDate;
      } else {
      const frequency = (recurring.frequency || "daily") as
        | "daily"
        | "weekly"
        | "custom";

      const rawStart = recurring.startDate || taskData.scheduledDate;
      const rawEnd = recurring.endDate;

      if (!rawStart) {
        throw new BadRequestError("Recurring tasks require a start date");
      }

      const startDate = normalizeDateOnly(
        typeof rawStart === "string" ? new Date(rawStart) : rawStart
      );

      let endDate: Date | null = rawEnd
        ? normalizeDateOnly(
          typeof rawEnd === "string" ? new Date(rawEnd) : rawEnd
        )
        : null;

      const occurrences = Number(recurring.occurrences || 0) || null;
      const stepDays = frequency === "weekly" ? 7 : 1;

      if (!endDate && occurrences) {
        const computedEnd = new Date(startDate);
        computedEnd.setDate(computedEnd.getDate() + stepDays * (occurrences - 1));
        endDate = normalizeDateOnly(computedEnd);
      }

      if (!endDate) {
        throw new BadRequestError("Recurring tasks require an end date or occurrences");
      }

      if (endDate.getTime() < startDate.getTime()) {
        throw new BadRequestError("Recurring end date must be after start date");
      }

      const scheduleDates = buildScheduleDates({
        startDate,
        endDate,
        frequency,
        maxOccurrences: 366,
      });

      if (scheduleDates.length === 0) {
        throw new BadRequestError("Recurring schedule has no dates");
      }

      taskPayload.recurring = {
        enabled: true,
        frequency,
        startDate,
        endDate,
        requireApproval: recurring.requireApproval !== false,
        minCommitment: recurring.minCommitment || undefined,
      };

      taskPayload.schedule = scheduleDates.map((date) => ({
        date,
        status: "open",
      }));

      taskPayload.scheduledDate = startDate;
      }
    }

    // Only include location if it was provided
    if (location) {
      taskPayload.location = location;
    }

    // Legacy top-level taskArea is no longer persisted; nested under location.taskArea.
    delete taskPayload.taskArea;

    // â”€â”€ Packers & Movers specific fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Only store when category is packers-movers â€” no impact on other categories
    if (mappedCategory === 'packers-movers' && taskData.packersMoversDetails) {
      const pm = taskData.packersMoversDetails;
      taskPayload.packersMoversDetails = {
        serviceType: pm.serviceType,
        houseType: pm.houseType,
        pickupAddress: pm.pickupAddress,
        pickupCoordinates: pm.pickupCoordinates,
        dropAddress: pm.dropAddress,
        dropCoordinates: pm.dropCoordinates,
        liftAtPickup: pm.liftAtPickup ?? true,
        liftAtDrop: pm.liftAtDrop ?? true,
        pickupFloor: pm.pickupFloor || undefined,
        dropFloor: pm.dropFloor || undefined,
        moveDate: pm.moveDate,
        moveTimeSlot: pm.moveTimeSlot,
        selectedItems: pm.selectedItems,
        packing: pm.packing ?? false,
        unpacking: pm.unpacking ?? false,
        loadingOnly: pm.loadingOnly ?? false,
        helpers: typeof pm.helpers === 'number' ? pm.helpers : parseInt(pm.helpers) || 2,
        offeredPrice: typeof pm.offeredPrice === 'number' ? pm.offeredPrice : parseFloat(pm.offeredPrice) || 0,
      };
    }

    // â”€â”€ Delivery / Pickup specific fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (mappedCategory === 'delivery' && taskData.subcategory) {
      const sub = String(taskData.subcategory).toLowerCase();

      if ((sub.includes('grocery') || sub.includes('shopping')) && taskData.groceryPickupDetails) {
        const gp = taskData.groceryPickupDetails;
        taskPayload.groceryPickupDetails = {
          groceryItems: gp.groceryItems,
          preferredStore: gp.preferredStore,
          shopLocation: gp.shopLocation,
          quantityNotes: gp.quantityNotes,
          urgentDelivery: gp.urgentDelivery ?? false,
          deliveryAddress: gp.deliveryAddress,
          deliveryLabel: gp.deliveryLabel,
          preferences: gp.preferences,
          estimatedAmount: typeof gp.estimatedAmount === 'number' ? gp.estimatedAmount : parseFloat(gp.estimatedAmount) || 0,
        };
      }

      if (sub.includes('medicine') && taskData.medicinePickupDetails) {
        const mp = taskData.medicinePickupDetails;
        taskPayload.medicinePickupDetails = {
          medicines: mp.medicines,
          specialInstructions: mp.specialInstructions,
          preferredPharmacy: mp.preferredPharmacy,
          pharmacyLocation: mp.pharmacyLocation,
          deliveryAddress: mp.deliveryAddress,
          deliveryLabel: mp.deliveryLabel,
          estimatedAmount: typeof mp.estimatedAmount === 'number' ? mp.estimatedAmount : parseFloat(mp.estimatedAmount) || 0,
        };
      }

      if ((sub.includes('pick') || sub.includes('drop')) && taskData.pickDropDetails) {
        const pd = taskData.pickDropDetails;
        taskPayload.pickDropDetails = {
          itemType: pd.itemType,
          itemDescription: pd.itemDescription,
          itemWeight: pd.itemWeight,
          packageType: pd.packageType,
          packageContents: Array.isArray(pd.packageContents) ? pd.packageContents : undefined,
          packageTypeOther: pd.packageTypeOther || undefined,
          packageContentsOther: pd.packageContentsOther || undefined,
          pickupAddress: pd.pickupAddress,
          pickupLabel: pd.pickupLabel,
          dropAddress: pd.dropAddress,
          receiverName: pd.receiverName,
          receiverMobile: pd.receiverMobile,
          useMyNumber: pd.useMyNumber ?? false,
          specialInstructions: pd.specialInstructions,
          estimatedItemValue: typeof pd.estimatedItemValue === 'number' ? pd.estimatedItemValue : parseFloat(pd.estimatedItemValue) || 0,
          deliveryBudget: typeof pd.deliveryBudget === 'number' ? pd.deliveryBudget : parseFloat(pd.deliveryBudget) || 0,
          packagePhotoUrl: pd.packagePhotoUrl || undefined,
        };
      }
    }

    const task = await Task.create(taskPayload);

    TaskService.invalidateTaskListCache();

    logger.info(`✅ Task created successfully: ${task._id}`);

    if (createdVisitMeta && createdVisitStartDate) {
      await RecurringVisitService.materializeInitialVisitBuffer(
        task as unknown as ITask,
        createdVisitMeta,
        createdVisitStartDate,
        createdVisitEndDate,
      );
    }

    const taskRecord = task.toObject() as ITask;
    schedulePostCreateNotifications(taskRecord, {
      uid,
      mappedCategory,
      categorySlug,
      frontendCategory,
    });

    return buildCreateTaskApiResponse(taskRecord);
  }

  /**
   * Update a task
   */
  static async updateTask(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
    updates: any
  ): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // âœ… Compare ObjectIds
    if (!task.requesterId.equals(profileId)) {
      throw new ForbiddenError("Not authorized to edit this task");
    }

    // STEP 1: Get old state for diff check
    const oldStatus = task.status;
    const oldScheduledDate = task.scheduledDate?.getTime();
    const oldAssigneeId = task.assigneeId; // âœ… Updated from assigneeUid

    // Normalize budget field to handle both object and number formats
    let updateData = { ...updates, updatedAt: new Date() };
    // Never trust client-sent flags for one-time budget rules.
    delete (updateData as any).posterBudgetEditedViaFormOnce;
    if (updateData.budget) {
      if (typeof updateData.budget !== "object") {
        // Convert budget number to object
        updateData.budget = {
          amount: parseFloat(updateData.budget) || 0,
          currency: "INR",
          type: "fixed",
        };
      }
    }

    // Non-negotiable + Pick & Drop: poster may change listed budget at most once via updateTask.
    if (enforcesOneTimePosterBudgetFormEdit(task) && updateData.budget) {
      const newAmt = Number((updateData.budget as any).amount);
      const oldAmt = Number((task.budget as any)?.amount ?? 0);
      if (Number.isFinite(newAmt) && newAmt !== oldAmt) {
        if ((task as any).posterBudgetEditedViaFormOnce === true) {
          throw new BadRequestError(
            taskHasPickDropDetails(task)
              ? 'You can only update the delivery budget once. Further budget changes are not allowed.'
              : 'You can only update the fixed budget once. Further budget changes are not allowed here.',
          );
        }
        (updateData as any).posterBudgetEditedViaFormOnce = true;
      }
    }

    // Map category if provided
    if (updateData.category) {
      updateData.category = mapCategoryToEnum(updateData.category);
    }
    if (updateData.categorySlug) {
      updateData.categorySlug = updateData.categorySlug.toString();
    }
    if (updateData.categoryLabel) {
      updateData.categoryLabel = updateData.categoryLabel.toString();
    }

    if (updateData.location) {
      updateData.location = applyTaskAreaToLocation(updateData.location, {
        taskArea: updateData.location.taskArea,
        legacyTaskArea: updateData.taskArea,
      });
      delete updateData.taskArea;
    } else if (updateData.taskArea) {
      updateData.location = applyTaskAreaToLocation(
        (task.location || {}) as Record<string, unknown>,
        { legacyTaskArea: updateData.taskArea },
      );
      delete updateData.taskArea;
    }

    // Reschedule invalidates prior start-soon WhatsApp idempotency keys.
    const scheduleFieldsTouched =
      updateData.scheduledDate !== undefined ||
      updateData.scheduledTimeStart !== undefined ||
      updateData.scheduledTimeEnd !== undefined;
    if (scheduleFieldsTouched) {
      const mergedSchedule = {
        scheduledDate: updateData.scheduledDate ?? task.scheduledDate,
        scheduledTimeStart: updateData.scheduledTimeStart ?? task.scheduledTimeStart,
        scheduledTimeEnd: updateData.scheduledTimeEnd ?? task.scheduledTimeEnd,
      };
      (updateData as Record<string, unknown>)['notificationGovernance.scheduleVersion'] =
        buildScheduleVersion(mergedSchedule);
    }

    logger.info("ðŸ” Update data after budget normalization:", updateData);

    const updatedTask = await Task.findByIdAndUpdate(taskId, updateData, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updatedTask) {
      throw new NotFoundError("Task not found");
    }

    logger.info(`Task updated: ${taskId} by user ${profileId.toString()}`);

    // STEP 2: Diff check - only emit if important fields changed
    const statusChanged = oldStatus !== updatedTask.status;
    const scheduledDateChanged = oldScheduledDate !== updatedTask.scheduledDate?.getTime();
    // âœ… Compare ObjectIds (need to convert to string for comparison)
    const oldAssigneeIdStr = oldAssigneeId?.toString();
    const newAssigneeIdStr = updatedTask.assigneeId?.toString();
    const assigneeChanged = oldAssigneeIdStr !== newAssigneeIdStr;

    if (statusChanged || scheduledDateChanged || assigneeChanged) {
      // STEP 3: Emit TASK_UPDATED notification
      // Resolve Firebase UIDs upfront so both push and in-app use correct IDs.
      const Profile = mongoose.connection.collection('profiles');
      const requesterProfileForNotif = await Profile.findOne({ _id: updatedTask.requesterId });
      const assigneeProfileForNotif = updatedTask.assigneeId
        ? await Profile.findOne({ _id: updatedTask.assigneeId })
        : null;

      const posterUidForNotif = requesterProfileForNotif?.uid
        ? String(requesterProfileForNotif.uid)
        : null;
      const taskerUidForNotif = assigneeProfileForNotif?.uid
        ? String(assigneeProfileForNotif.uid)
        : null;

      // Firebase UIDs only â€” ObjectIds are not valid notification recipients.
      const uidRecipients: string[] = [];
      if (posterUidForNotif) uidRecipients.push(posterUidForNotif);
      if (taskerUidForNotif) uidRecipients.push(taskerUidForNotif);

      // Determine what changed for notification bodies
      let changeDetails = '';
      if (statusChanged) changeDetails += `Status updated to ${updatedTask.status}. `;
      if (scheduledDateChanged) changeDetails += `Scheduled date has been changed. `;
      if (assigneeChanged) changeDetails += `Assignment has been updated. `;

      try {

        // Push only actionable updates; keep everything else in in-app history.
        const actionableStatuses = new Set([
          'assigned',
          'started',
          'in_progress',
          'review',
          'completed',
          'cancelled',
          'canceled',
        ]);
        const nextStatus = String(updatedTask.status || '').toLowerCase();
        const isActionable =
          (statusChanged && actionableStatuses.has(nextStatus)) ||
          scheduledDateChanged ||
          assigneeChanged;

        if (isActionable && uidRecipients.length > 0) {
          await NotificationClient.send({
            eventKey: 'TASK_UPDATED',
            category: 'taskUpdates',
            actorId: posterUidForNotif ?? profileId.toString(),
            recipients: uidRecipients,
            entity: { type: 'task', id: taskId },
            title: `Work Updated: ${updatedTask.title}`,
            body: changeDetails || 'This work has been updated.',
            data: {
              taskId,
              status: updatedTask.status,
              scheduledDate: updatedTask.scheduledDate?.toISOString(),
              entityType: 'task',
              eventKey: 'TASK_UPDATED',
            },
          });
        } else if (!isActionable) {
          logger.info('Skipping TASK_UPDATED push (non-actionable update)', {
            taskId,
            status: updatedTask.status,
            statusChanged,
            scheduledDateChanged,
            assigneeChanged,
          });
        }
      } catch (error) {
        logger.error('Error sending TASK_UPDATED notification', {
          taskId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Always record update in in-app notification history (poster + tasker)
      // Uses Firebase UIDs (not ObjectIds) so the notification service can find the user.
      try {
        const Profile = mongoose.connection.collection('profiles');
        const requesterProfile = await Profile.findOne({ _id: updatedTask.requesterId });
        const assigneeProfile = updatedTask.assigneeId
          ? await Profile.findOne({ _id: updatedTask.assigneeId })
          : null;

        const uidRecipients: Array<{ uid: string; isTasker: boolean }> = [];
        if (requesterProfile?.uid) {
          uidRecipients.push({ uid: String(requesterProfile.uid), isTasker: false });
        }
        if (assigneeProfile?.uid) {
          uidRecipients.push({ uid: String(assigneeProfile.uid), isTasker: true });
        }

        for (const { uid, isTasker } of uidRecipients) {
          let title = `Work updated: ${updatedTask.title}`;
          let body = changeDetails || 'This work has been updated.';

          if (isTasker) {
            if (scheduledDateChanged) {
              title = 'Schedule changed';
              body = `The schedule for "${updatedTask.title}" has been updated. Please check the new date.`;
            } else if (statusChanged) {
              title = 'Work status updated';
              body = `"${updatedTask.title}" status changed to ${updatedTask.status}.`;
            } else if (assigneeChanged) {
              title = 'Assignment updated';
              body = `Your assignment for "${updatedTask.title}" has been updated.`;
            }
          }

          await InAppNotificationClient.send({
            userId: uid,
            title,
            body,
            category: 'taskUpdates',
            type: 'info',
            data: {
              taskId,
              status: updatedTask.status,
              scheduledDate: updatedTask.scheduledDate?.toISOString(),
              entityType: 'task',
              eventKey: 'TASK_UPDATED',
            },
          });
        }
      } catch (inAppErr) {
        logger.warn('Error sending TASK_UPDATED in-app notification', {
          taskId,
          error: inAppErr instanceof Error ? inAppErr.message : 'Unknown error',
        });
      }

      // Email: task_updated â†’ requester + assignee
      try {
        const changes: Array<{ field: string; oldValue?: string; newValue: string }> = [];
        if (statusChanged) {
          changes.push({ field: 'Status', oldValue: oldStatus, newValue: updatedTask.status });
        }
        if (scheduledDateChanged) {
          changes.push({
            field: 'Scheduled date',
            oldValue: task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined,
            newValue: updatedTask.scheduledDate ? new Date(updatedTask.scheduledDate).toLocaleDateString() : 'Updated',
          });
        }
        if (assigneeChanged) {
          changes.push({ field: 'Assignment', newValue: 'Updated' });
        }
        const Profile = mongoose.connection.collection('profiles');
        const taskUrl = `${config.WEB_APP_URL}/tasks/${taskId}`;
        const requesterProfile = await Profile.findOne({ _id: updatedTask.requesterId });
        if (requesterProfile?.email) {
          EmailServiceClient.sendTaskUpdated(requesterProfile.email, {
            recipientName: requesterProfile.name || requesterProfile.fullName || 'There',
            taskTitle: updatedTask.title,
            changes,
            taskUrl,
            userId: requesterProfile.uid,
          }).catch((err) =>
            logger.error('Error sending task_updated email to requester', {
              taskId,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          );
        }
        if (updatedTask.assigneeId) {
          const assigneeProfile = await Profile.findOne({ _id: updatedTask.assigneeId });
          if (assigneeProfile?.email) {
            EmailServiceClient.sendTaskUpdated(assigneeProfile.email, {
              recipientName: assigneeProfile.name || assigneeProfile.fullName || 'There',
              taskTitle: updatedTask.title,
              changes,
              taskUrl,
              userId: assigneeProfile.uid,
            }).catch((err) =>
              logger.error('Error sending task_updated email to assignee', {
                taskId,
                error: err instanceof Error ? err.message : 'Unknown error',
              })
            );
          }
        }
      } catch (error) {
        logger.error('Error sending task_updated emails', {
          taskId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    TaskService.invalidateTaskCache(taskId);
    return updatedTask as unknown as ITask;
  }

  /** Collect parent task plus recurring visit child tasks linked in schedule or RecurringVisit collection. */
  private static async collectTaskTreeIds(root: ITask): Promise<mongoose.Types.ObjectId[]> {
    const idSet = new Set<string>();
    idSet.add(String(root._id));

    const { RecurringVisitRepository } = await import('../repositories/RecurringVisitRepository');
    const collectionChildIds = await RecurringVisitRepository.listChildTaskIds(root._id);
    for (const childId of collectionChildIds) {
      idSet.add(childId);
    }

    const schedule = Array.isArray(root.schedule) ? root.schedule : [];
    for (const row of schedule) {
      const childTaskId = (row as { childTaskId?: mongoose.Types.ObjectId | string | null })
        .childTaskId;
      if (childTaskId) {
        idSet.add(String(childTaskId));
      }
    }

    const linkedChildren = await Task.find({ parentTaskId: root._id }).select("_id").lean();
    for (const child of linkedChildren) {
      idSet.add(String(child._id));
    }

    return [...idSet]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
  }

  private static async deleteTaskRelatedRecords(
    taskIds: mongoose.Types.ObjectId[],
  ): Promise<void> {
    if (taskIds.length === 0) return;

    await Promise.all([
      TaskApplication.deleteMany({ taskId: { $in: taskIds } }),
      TaskQuestion.deleteMany({ taskId: { $in: taskIds } }),
      TaskFollow.deleteMany({ taskId: { $in: taskIds } }),
      TaskReport.deleteMany({ taskId: { $in: taskIds } }),
    ]);
  }

  /**
   * Delete or soft-remove a task for the customer.
   * - Untouched unpaid marketplace open tasks → hard delete
   * - Active / assigned / in-progress → reject
   * - Paid / completed / cancelled / Book Now with financial history → soft delete
   * Refund status never blocks soft deletion (financial rows are retained).
   */
  static async deleteTask(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
    options?: { actorUid?: string },
  ): Promise<{ deletionType: 'hard' | 'soft'; message: string }> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (!task.requesterId.equals(profileId)) {
      throw new ForbiddenError("Not authorized to delete this task");
    }

    if (task.isDeletedByCustomer) {
      return {
        deletionType: 'soft',
        message: 'Work deleted successfully.',
      };
    }

    const status = String(task.status || '').toLowerCase();
    const executionPhase = String((task as any).executionPhase || '').toLowerCase();

    const ACTIVE_DELETE_BLOCKED_STATUSES = new Set([
      'assigned',
      'started',
      'in_progress',
      'ongoing',
      'review',
    ]);
    const ACTIVE_EXECUTION_PHASES = new Set(['on_the_way', 'arrived']);

    if (ACTIVE_DELETE_BLOCKED_STATUSES.has(status) || ACTIVE_EXECUTION_PHASES.has(executionPhase)) {
      throw new ConflictError(
        'This work cannot be deleted while it is active.',
        'TASK_ACTIVE',
      );
    }

    const hasAssignee = Boolean(
      task.assigneeId ||
        task.assigneeUid ||
        task.acceptedApplicationId ||
        (task as any).assignedHelperName,
    );

    const isBookNow = String(task.bookingSource || '') === 'book_now';
    const bookingOrderId = String(task.bookingOrderId || '').trim() || undefined;

    let safety: Awaited<ReturnType<typeof PaymentClient.getTaskDeletionSafety>>;
    try {
      safety = await PaymentClient.getTaskDeletionSafety(String(task._id), {
        bookingOrderId,
      });
    } catch (err) {
      logger.error('[TaskService.deleteTask] Payment deletion-safety lookup failed', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Never hard-delete when finance state is unknown.
      throw new ServiceUnavailableError(
        'Unable to verify payment records right now. Please try again shortly.',
        'PAYMENT_SERVICE_UNAVAILABLE',
      );
    }

    const completionProof = Array.isArray(task.completionProof) ? task.completionProof : [];
    const hasCompletionProof = completionProof.length > 0;
    const isTerminalStatus = status === 'completed' || status === 'cancelled';

    const mustSoftDelete =
      isBookNow ||
      safety.hasFinancialHistory ||
      safety.hasSuccessfulPayment ||
      safety.hasEscrow ||
      safety.hasRefund ||
      safety.hasPayout ||
      hasAssignee ||
      hasCompletionProof ||
      isTerminalStatus ||
      Boolean(task.assignedAt);

    const canHardDelete =
      !mustSoftDelete &&
      status === 'open' &&
      !hasAssignee &&
      safety.safeToHardDelete;

    if (canHardDelete) {
      const taskIdsToDelete = await TaskService.collectTaskTreeIds(task);
      await TaskService.deleteTaskRelatedRecords(taskIdsToDelete);
      await Task.deleteMany({ _id: { $in: taskIdsToDelete } });

      for (const id of taskIdsToDelete) {
        TaskService.invalidateTaskCache(String(id));
      }

      logger.info(
        `Task hard-deleted: ${taskId} by user ${profileId.toString()} (including ${Math.max(0, taskIdsToDelete.length - 1)} visit child task(s))`,
      );

      return {
        deletionType: 'hard',
        message: 'Work deleted successfully.',
      };
    }

    // Soft delete — preserve document + lifecycle status
    const now = new Date();
    const actorId = String(options?.actorUid || profileId.toString());
    const treeIds = await TaskService.collectTaskTreeIds(task);

    await Task.updateMany(
      { _id: { $in: treeIds } },
      {
        $set: {
          isDeletedByCustomer: true,
          deletedByCustomerAt: now,
          deletedByCustomerId: actorId,
        },
      },
    );

    if (bookingOrderId) {
      await BookingOrder.updateOne(
        { orderId: bookingOrderId },
        {
          $set: {
            isDeletedByCustomer: true,
            deletedByCustomerAt: now,
            deletedByCustomerId: actorId,
          },
        },
      );
    }

    for (const id of treeIds) {
      TaskService.invalidateTaskCache(String(id));
    }

    logger.info(
      `Task soft-deleted by customer: ${taskId} (status=${status}, bookNow=${isBookNow}) by ${actorId}`,
    );

    return {
      deletionType: 'soft',
      message: 'Work deleted successfully.',
    };
  }

  /**
   * Increment task views
   */
  static async incrementViews(taskId: string): Promise<void> {
    await Task.findByIdAndUpdate(taskId, { $inc: { views: 1 } });
  }

  /** Scheduled start for cancellation fee policy (aligned with web tracking UI). */
  private static getTaskStartDateForCancellationPolicy(task: ITask): Date {
    const now = Date.now();
    if (!task.scheduledDate) {
      return new Date(now + 999 * 60 * 60 * 1000);
    }
    const d = new Date(task.scheduledDate);
    const ts = task.scheduledTimeStart;
    if (ts && typeof ts === "string") {
      const timeMatch = ts.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const mod = timeMatch[3]?.toLowerCase();
        if (mod === "pm" && hours < 12) hours += 12;
        if (mod === "am" && hours === 12) hours = 0;
        d.setHours(hours, mins, 0, 0);
      }
    }
    return d;
  }

  /**
   * Cancel a recurring plan visit using the same task cancellation flow as normal work
   * (refund policy, fees, notifications). Delegates to the per-visit child task when present.
   */
  static async cancelRecurringVisit(
    planTaskId: string,
    visitId: string,
    profileId: mongoose.Types.ObjectId,
    options?: { cancellationReason?: string },
  ): Promise<ITask | void> {
    const parent = await Task.findById(planTaskId);
    if (!parent) {
      throw new NotFoundError("Task not found");
    }
    if (!isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      throw new BadRequestError("Not a recurring visit plan");
    }

    const isCreator = parent.requesterId.equals(profileId);
    const isPerformer = parent.assigneeId?.equals(profileId) || false;
    if (!isCreator && !isPerformer) {
      throw new ForbiddenError("Not authorized to cancel this visit");
    }

    const visit = await findVisitForPlan(parent, visitId);
    if (!visit) {
      throw new NotFoundError("Visit not found");
    }

    if (visit.childTaskId) {
      const child = await Task.findById(visit.childTaskId);
      if (child && !["cancelled", "completed"].includes(String(child.status))) {
        return TaskService.updateTaskStatus(
          String(child._id),
          profileId,
          "cancelled",
          options,
        );
      }
    }

    if (!isCreator) {
      throw new BadRequestError(
        "This visit is not assigned yet. Only the customer can cancel it.",
      );
    }

    await RecurringVisitService.cancelUnpaidVisitOnPlan({
      taskId: planTaskId,
      visitId,
      requesterProfileId: profileId,
      reason: options?.cancellationReason,
    });
  }

  /**
   * Update task status
   */
  static async updateTaskStatus(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
    status: TaskStatus,
    options?: { cancellationReason?: string; skipStartOtpValidation?: boolean }
  ): Promise<ITask> {
    const validStatuses: TaskStatus[] = [
      "open",
      "assigned",
      "started",
      "in_progress",
      "review",
      "completed",
      "cancelled",
    ];

    if (!validStatuses.includes(status)) {
      throw new BadRequestError("Invalid status");
    }

    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // âœ… Compare ObjectIds
    const isCreator = task.requesterId.equals(profileId);
    let isPerformer = task.assigneeId?.equals(profileId) || false; // âœ… Updated from assigneeUid

    if (!isCreator && !isPerformer && task.parentTaskId && task.recurringVisitId) {
      const parent = await Task.findById(task.parentTaskId).select(
        "assigneeId recurringPlan",
      );
      if (parent) {
        const plan = (parent as unknown as { recurringPlan?: Record<string, unknown> })
          .recurringPlan;
        isPerformer =
          parent.assigneeId?.equals(profileId) ||
          (plan?.taskerProfileId as mongoose.Types.ObjectId | undefined)?.equals(
            profileId,
          ) ||
          false;
      }
    }

    if (!isCreator && !isPerformer) {
      throw new ForbiddenError("Not authorized to update this task");
    }

    // Performer-only transitions
    if (isPerformer && !isCreator) {
      const allowed = ["started", "in_progress", "review", "cancelled"];
      if (!allowed.includes(status)) {
        throw new ForbiddenError(
          "Performer can only update status to started, in_progress, review, or cancelled"
        );
      }
    }

    // Creator-only restrictions
    if (isCreator && !isPerformer) {
      const restricted = ["started", "in_progress"];
      if (restricted.includes(status)) {
        throw new ForbiddenError(
          "Only assigned performer can mark task as started or in_progress"
        );
      }
    }

    if (
      (status === "started" || status === "in_progress") &&
      isPerformer &&
      isRecurringVisitPlanTask(task as unknown as Record<string, unknown>) &&
      !task.parentTaskId
    ) {
      const workChild = await RecurringVisitService.resolveActiveWorkChildTask(task);
      if (workChild) {
        return TaskService.updateTaskStatus(String(workChild._id), profileId, status, options);
      }
      throw new BadRequestError(
        "Recurring visit work must be started on the paid visit task, not the plan"
      );
    }

    // Recurring per-visit payment must be confirmed before any start transition (OTP path included).
    if (
      (status === "started" || status === "in_progress") &&
      task.status === "assigned" &&
      isPerformer
    ) {
      await RecurringVisitService.ensureVisitPaidBeforeWorkStart(task);
    }

    // OTP gate: performer cannot move assigned -> started/in_progress without successful OTP verification.
    if (
      (status === "started" || status === "in_progress") &&
      task.status === "assigned" &&
      isPerformer &&
      !options?.skipStartOtpValidation
    ) {
      const pendingAdditionalQuote = getPendingAdditionalQuoteRequest(task);
      if (pendingAdditionalQuote) {
        throw new BadRequestError(
          "Cannot start task while an additional payment request is pending decision"
        );
      }

      const startOtp = task.startOtp;
      if (!startOtp?.verifiedAt) {
        throw new BadRequestError("Start OTP verification required before starting task");
      }
    }

    // Once work starts, cancellation is not allowed.
    if (status === "cancelled" && task.status !== "assigned") {
      throw new BadRequestError("Task can only be cancelled before it is started");
    }

    // Performer cannot cancel after payment is held â€” except recurring per-visit child
    // tasks, where refund policy runs below (same as poster cancel on assigned visits).
    if (status === "cancelled" && isPerformer && !isCreator) {
      const isRecurringChildVisit =
        Boolean(task.parentTaskId) && Boolean(task.recurringVisitId);
      if (!isRecurringChildVisit) {
        let escrowForCancel = await PaymentClient.getEscrowByTaskId(taskId);
        if (!escrowForCancel && task.parentTaskId && task.recurringVisitId) {
          escrowForCancel = await PaymentClient.getEscrowByTaskIdAndVisitId(
            String(task.parentTaskId),
            String(task.recurringVisitId),
          );
        }
        if (isActiveEscrow(escrowForCancel)) {
          throw new BadRequestError(
            "Cannot cancel after payment is held. Contact support if you need help."
          );
        }
      }
    }

    let cancellationPaymentResult:
      | { success: boolean; cancelled?: boolean; refundRequired?: boolean; refund?: unknown; error?: string }
      | null = null;

    if (status === "cancelled") {
      let escrow = await PaymentClient.getEscrowByTaskId(taskId);
      if (!escrow && task.parentTaskId && task.recurringVisitId) {
        escrow = await PaymentClient.getEscrowByTaskIdAndVisitId(
          String(task.parentTaskId),
          String(task.recurringVisitId),
        );
      }
      if (escrow) {
        const isRequesterCancelled = task.requesterId.equals(profileId);
        const Profile = mongoose.connection.collection("profiles");
        const cancellerProfile = await Profile.findOne({ _id: profileId });
        const rawUid =
          cancellerProfile && typeof cancellerProfile === "object" && "uid" in cancellerProfile
            ? (cancellerProfile as { uid?: unknown }).uid
            : undefined;
        const uid = typeof rawUid === "string" ? rawUid : undefined;
        const taskStart = TaskService.getTaskStartDateForCancellationPolicy(task);
        const taskBudgetAmount =
          task.budget && typeof task.budget === "object" && "amount" in task.budget
            ? Number((task.budget as { amount: number }).amount)
            : undefined;
        const escrowPublicId =
          escrow && typeof escrow === "object"
            ? String((escrow as { escrowId?: unknown }).escrowId ?? "").trim() || undefined
            : undefined;
        const cancelTaskId = escrowPublicId
          ? undefined
          : task.parentTaskId && task.recurringVisitId
            ? String(task.parentTaskId)
            : taskId;
        logger.info('[TaskService.updateTaskStatus] Cancellation payment workflow started', {
          taskId,
          actorProfileId: profileId.toString(),
          actorRole: isRequesterCancelled ? 'poster' : 'performer',
          actorUid: uid,
          hasEscrow: true,
          escrowPublicId,
          cancelTaskId,
          recurringParentTaskId: task.parentTaskId ? String(task.parentTaskId) : undefined,
          recurringVisitId: task.recurringVisitId,
          taskStartDate: taskStart.toISOString(),
          assignedAt: task.assignedAt ? new Date(task.assignedAt).toISOString() : undefined,
          feeBaseAmount:
            taskBudgetAmount !== undefined && Number.isFinite(taskBudgetAmount)
              ? taskBudgetAmount
              : undefined,
        });
        const payResult = await PaymentClient.cancelPaymentForTask({
          taskId: cancelTaskId,
          escrowId: escrowPublicId,
          bookingOrderId:
            typeof task.bookingOrderId === 'string' && task.bookingOrderId.trim()
              ? task.bookingOrderId.trim()
              : undefined,
          reason: options?.cancellationReason,
          userId: uid,
          cancelledBy: isRequesterCancelled ? "poster" : "performer",
          taskStartDate: taskStart.toISOString(),
          assignedAt: task.assignedAt
            ? new Date(task.assignedAt).toISOString()
            : undefined,
          feeBaseAmount:
            taskBudgetAmount !== undefined && Number.isFinite(taskBudgetAmount)
              ? taskBudgetAmount
              : undefined,
          taskTitle: typeof task.title === "string" ? task.title : undefined,
        });
        cancellationPaymentResult = payResult;
        logger.info('[TaskService.updateTaskStatus] Cancellation payment workflow completed', {
          taskId,
          actorRole: isRequesterCancelled ? 'poster' : 'performer',
          success: payResult.success,
          cancelled: payResult.cancelled,
          refundRequired: payResult.refundRequired,
          refund: payResult.refund,
          error: payResult.error,
        });
        if (!payResult.success) {
          throw new BadRequestError(
            payResult.error ||
              "Payment could not be cancelled or refunded. Please try again or contact support."
          );
        }
      }
    }

    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (status === "started") {
      updateData.startedAt = new Date();
    }

    if (status === "in_progress") {
      updateData.inProgressAt = new Date();
      // Backfill startedAt if task jumps directly to in_progress.
      if (!task.startedAt) {
        updateData.startedAt = new Date();
      }
    }

    if (status === "review") {
      const submittedAt = new Date();
      updateData.reviewAt = submittedAt;
      updateData.completionSubmittedAt = submittedAt;
    }

    if (status === "completed") {
      updateData.completedAt = new Date();
    }

    if (status === "cancelled") {
      updateData.cancelledAt = new Date();
      updateData.cancelledById = profileId; // âœ… Updated from cancelledBy
      updateData.cancellationReason = options?.cancellationReason;
    }

    // Clear OTP state once task leaves assigned state.
    if (task.status === "assigned" && status !== "assigned") {
      updateData.startOtp = undefined;
    }

    const updatedTask = await Task.findByIdAndUpdate(taskId, updateData, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updatedTask) {
      throw new NotFoundError("Task not found");
    }

    logger.info(`Task ${taskId} status updated to ${status} by ${profileId.toString()}`);

    if (
      status === 'completed' &&
      updatedTask.parentTaskId &&
      updatedTask.recurringVisitId
    ) {
      setImmediate(async () => {
        try {
          await RecurringVisitService.onChildVisitCompleted(updatedTask as unknown as ITask);
        } catch (err) {
          logger.error('[TaskService] Failed to advance recurring visit plan after child completion', {
            taskId,
            parentTaskId: String(updatedTask.parentTaskId),
            recurringVisitId: updatedTask.recurringVisitId,
            error: err,
          });
        }
      });
    }

    if (
      status === 'cancelled' &&
      updatedTask.parentTaskId &&
      updatedTask.recurringVisitId
    ) {
      setImmediate(async () => {
        try {
          await RecurringVisitService.onChildVisitCancelled(updatedTask as unknown as ITask, {
            reason: options?.cancellationReason,
            cancelledByProfileId: profileId,
          });
        } catch (err) {
          logger.error('[TaskService] Failed to advance recurring visit plan after child cancellation', {
            taskId,
            parentTaskId: String(updatedTask.parentTaskId),
            recurringVisitId: updatedTask.recurringVisitId,
            error: err,
          });
        }
      });
    }

    const PROGRESS_VISIT_STATUSES = new Set(['started', 'in_progress', 'review']);
    if (
      PROGRESS_VISIT_STATUSES.has(status) &&
      updatedTask.parentTaskId &&
      updatedTask.recurringVisitId
    ) {
      setImmediate(async () => {
        try {
          await RecurringVisitService.syncParentVisitOnChildProgress(
            updatedTask as unknown as ITask,
            status,
          );
        } catch (err) {
          logger.error('[TaskService] Failed to sync recurring visit progress from child task', {
            taskId,
            parentTaskId: String(updatedTask.parentTaskId),
            recurringVisitId: updatedTask.recurringVisitId,
            error: err,
          });
        }
      });
    }

    if (
      PROGRESS_VISIT_STATUSES.has(status) &&
      !updatedTask.parentTaskId &&
      RecurringVisitService.isVisitPlanTask(updatedTask as unknown as Record<string, unknown>)
    ) {
      setImmediate(async () => {
        try {
          await RecurringVisitService.reconcilePlanState(taskId);
        } catch (err) {
          logger.error('[TaskService] Failed to reconcile recurring parent visit progress', {
            taskId,
            error: err,
          });
        }
      });
    }

    // Emit real-time status update
    emitTaskStatusChanged(taskId, updatedTask);

    // â”€â”€ Push + in-app notifications for progress status changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Notify the poster whenever the tasker moves the task forward.
    // Runs non-blocking so it never delays the HTTP response.
    const PROGRESS_STATUSES = new Set(['started', 'in_progress', 'review']);
    if (PROGRESS_STATUSES.has(status) && isPerformer) {
      setImmediate(async () => {
        try {
          const Profile = mongoose.connection.collection('profiles');
          const requesterProfile = await Profile.findOne({ _id: task.requesterId });
          const posterUid =
            requesterProfile &&
            typeof requesterProfile === 'object' &&
            'uid' in requesterProfile
              ? String((requesterProfile as any).uid || '')
              : '';

          if (!posterUid) {
            logger.warn('[TaskService] Progress notification: could not resolve poster UID', { taskId, status });
            return;
          }

          const assigneeProfile = task.assigneeId
            ? await Profile.findOne({ _id: task.assigneeId })
            : null;
          const taskerName: string =
            (assigneeProfile as any)?.name ||
            (assigneeProfile as any)?.fullName ||
            'Your helper';

          const statusLabels: Record<string, { title: string; body: string }> = {
            started: {
              title: 'Work has started',
              body: `${taskerName} has started working on "${task.title}".`,
            },
            in_progress: {
              title: 'Work is in progress',
              body: `${taskerName} has marked "${task.title}" as in progress.`,
            },
            review: {
              title: 'Work submitted for review',
              body: `${taskerName} has submitted "${task.title}" for your review. Please check and approve.`,
            },
          };

          const { title, body } = statusLabels[status] ?? {
            title: 'Task update',
            body: `The status of "${task.title}" has been updated to ${status}.`,
          };

          const notificationData = {
            taskId,
            status,
            eventKey: 'TASK_UPDATED',
            entityType: 'task',
          };

          // Push notification (FCM)
          await NotificationClient.send({
            eventKey: 'TASK_UPDATED',
            category: 'taskUpdates',
            actorId: String(profileId),
            recipients: [posterUid],
            entity: { type: 'task', id: taskId },
            title,
            body,
            data: notificationData,
          });

          // In-app notification (polling / notification centre)
          await InAppNotificationClient.send({
            userId: posterUid,
            title,
            body,
            type: status === 'review' ? 'success' : 'info',
            category: 'taskUpdates',
            data: notificationData,
          });

          logger.info('[TaskService] Progress notification sent to poster', {
            taskId,
            status,
            posterUid,
          });
        } catch (err) {
          logger.warn('[TaskService] Failed to send progress notification to poster', {
            taskId,
            status,
            error: err instanceof Error ? err.message : err,
          });
        }
      });
    }

    // â”€â”€ Push + in-app notifications to tasker for poster-triggered status changes â”€â”€
    // When the poster marks the task completed, notify the tasker immediately.
    if (status === 'completed' && isCreator && task.assigneeId) {
      const assigneeId = task.assigneeId;
      setImmediate(async () => {
        try {
          if (!assigneeId) return;
          const Profile = mongoose.connection.collection('profiles');
          const assigneeProfile = await Profile.findOne({ _id: assigneeId });
          const taskerUid = assigneeProfile?.uid ? String(assigneeProfile.uid) : '';

          if (!taskerUid) {
            logger.warn('[TaskService] Completed notification: could not resolve tasker UID', { taskId });
            return;
          }

          const notifData = {
            taskId,
            taskTitle: task.title || 'your task',
            status: 'completed',
            eventKey: 'TASK_COMPLETED_TASKER',
            entityType: 'task',
          };

          // Push notification
          await NotificationClient.send({
            eventKey: 'TASK_COMPLETED_TASKER',
            category: 'taskUpdates',
            actorId: String(profileId),
            recipients: [taskerUid],
            entity: { type: 'task', id: taskId },
            title: 'Work approved',
            body: `The poster has approved your work on "${task.title}". Payment will be processed shortly.`,
            data: notifData,
          });

          // In-app notification
          await InAppNotificationClient.send({
            userId: taskerUid,
            title: 'Work approved',
            body: `The poster has approved your work on "${task.title}". Payment will be processed shortly.`,
            type: 'success',
            category: 'taskUpdates',
            data: notifData,
          });

          const waMinute = Math.floor(Date.now() / 60000);
          fireDialogWhatsAppForUser({
            uid: taskerUid,
            eventKey: 'TASK_COMPLETED_TASKER',
            category: 'taskUpdates',
            payload: {
              title: 'Work approved',
              body: `The poster has approved your work on "${task.title}". Payment will be processed shortly.`,
              taskTitle: task.title || 'your task',
              taskId,
              status: 'completed',
            },
            idempotencyKey:
              `eh-push:${taskerUid}:TASK_COMPLETED_TASKER:${taskId}:${waMinute}`.slice(0, 200),
          });
          fireWhatsAppNotify({
            uid: taskerUid,
            templateKey: 'wa_work_completed_helper',
            category: 'taskUpdates',
            templateBody: { var_1: task.title || 'your task' },
            templateButtons: taskOpenAppButton(String(taskId)),
            idempotencyKey: `completed-helper:${taskId}`,
            metadata: {
              workId: String(taskId),
              recipientRole: 'helper',
              metaTemplateName: 'extrahand_work_completed_helper',
            },
          });

          logger.info('[TaskService] Completion notification sent to tasker', { taskId, taskerUid });

          const { posterUid, assigneeUid: helperUid } = await resolveTaskParticipantUids(task);
          if (posterUid) {
            await notifyPosterOnTaskCompleted({
              taskId: String(taskId),
              taskTitle: task.title || 'your work',
              posterUid,
              assigneeUid: helperUid || taskerUid,
              actorUid: helperUid || taskerUid,
            });
            logger.info('[TaskService] Completion notification sent to poster', {
              taskId,
              posterUid,
            });
          }
        } catch (err) {
          logger.warn('[TaskService] Failed to send completion notification to tasker', {
            taskId,
            error: err instanceof Error ? err.message : err,
          });
        }
      });
    }

    // Email: task cancelled â†’ notify the other party
    if (status === "cancelled") {
      try {
        const Profile = mongoose.connection.collection("profiles");
        const isRequesterCancelled = task.requesterId.equals(profileId);
        const otherPartyId = isRequesterCancelled ? task.assigneeId : task.requesterId;
        const cancellerProfile = await Profile.findOne({ _id: profileId });

        // Fallback for poster: ensure cancellation + refund timeline notification is created
        // even if payment-service in-app notification fails.
        if (isRequesterCancelled && cancellationPaymentResult?.refundRequired) {
          const requesterProfile = await Profile.findOne({ _id: task.requesterId });
          if (requesterProfile?.uid) {
            logger.info('[TaskService.updateTaskStatus] Sending poster refund fallback in-app notification', {
              taskId,
              posterUid: requesterProfile.uid,
              actionUrl: `/tasks/${taskId}/track`,
            });

            await InAppNotificationClient.send({
              userId: requesterProfile.uid,
              title: 'Task cancelled',
              body: `The task "${task.title}" has been cancelled. Amount will be refunded within 5-7 days.`,
              type: 'warning',
              category: 'payments',
              data: {
                taskId: taskId.toString(),
                actionUrl: `/tasks/${taskId}/track`,
                eventKey: 'REFUND_INITIATED',
                entityType: 'refund',
              },
            });

            await NotificationClient.send({
              eventKey: 'TASK_CANCELLED_CUSTOMER',
              category: 'taskUpdates',
              actorId: 'system',
              recipients: [requesterProfile.uid],
              entity: { type: 'task', id: taskId.toString() },
              title: 'Task cancelled',
              body: `The task "${task.title}" has been cancelled. Amount will be refunded within 5-7 days.`,
              data: {
                taskId: taskId.toString(),
                actionUrl: `/tasks/${taskId}/track`,
                eventKey: 'REFUND_INITIATED',
                entityType: 'refund',
              },
            });
          }
        }

        if (otherPartyId) {
          const otherProfile = await Profile.findOne({ _id: otherPartyId });
          if (otherProfile?.email) {
            EmailServiceClient.sendTaskCancelled(otherProfile.email, {
              recipientName: otherProfile.name || otherProfile.fullName || "There",
              taskTitle: task.title,
              cancelledByName: cancellerProfile?.name || cancellerProfile?.fullName,
              reason: options?.cancellationReason,
              browseUrl: `${config.WEB_APP_URL}/tasks`,
              userId: otherProfile.uid,
            }).catch((err) =>
              logger.error("Error sending task_cancelled email", {
                taskId,
                error: err instanceof Error ? err.message : "Unknown error",
              })
            );
          }

          if (otherProfile?.uid) {
            // isRequesterCancelled = true means the poster/partner cancelled → notify helper
            // isRequesterCancelled = false means the performer/helper cancelled → notify partner
            const otherRole = isRequesterCancelled ? 'helper' : 'partner';
            logger.info('[TaskService.updateTaskStatus] Sending task cancelled in-app notification', {
              taskId,
              recipientUid: otherProfile.uid,
              recipientRole: otherRole,
              cancelledBy: isRequesterCancelled ? 'partner' : 'helper',
              actionUrl: `${config.WEB_APP_URL}/tasks/${taskId}/track`,
            });

            await InAppNotificationClient.send({
              userId: otherProfile.uid,
              title: 'Task cancelled',
              body: `The task "${task.title}" has been cancelled. Open the task track page for details.`,
              type: 'warning',
              category: 'taskUpdates',
              data: {
                taskId: taskId.toString(),
                actionUrl: `/tasks/${taskId}/track`,
                recipientRole: otherRole,
              },
            });

            // Push → notification-service → Dialog WhatsApp (when Settings WA is on).
            // eventKey selects customer vs helper Meta cancel template via Dialog rules.
            const cancelEventKey = isRequesterCancelled
              ? 'TASK_CANCELLED_HELPER'
              : 'TASK_CANCELLED_CUSTOMER';
            const cancelTitle = 'Task cancelled';
            const cancelBody = `The task "${task.title}" has been cancelled.`;
            const cancelTaskTitle = task.title || 'your task';
            try {
              await NotificationClient.send({
                eventKey: cancelEventKey,
                category: 'taskUpdates',
                actorId: String(cancellerProfile?.uid || profileId),
                recipients: [otherProfile.uid],
                entity: { type: 'task', id: taskId.toString() },
                title: cancelTitle,
                body: cancelBody,
                data: {
                  taskId: taskId.toString(),
                  taskTitle: cancelTaskTitle,
                  actionUrl: `/tasks/${taskId}/track`,
                  eventKey: cancelEventKey,
                  entityType: 'task',
                },
              });
            } catch (pushErr) {
              logger.warn('Error sending task cancelled push notification', {
                taskId,
                cancelEventKey,
                error: pushErr instanceof Error ? pushErr.message : 'Unknown error',
              });
            }

            // Dialog WhatsApp — customer cancel → helper gets extrahand_work_cancelled_helper
            const waMinute = Math.floor(Date.now() / 60000);
            fireDialogWhatsAppForUser({
              uid: otherProfile.uid,
              eventKey: cancelEventKey,
              category: 'taskUpdates',
              payload: {
                title: cancelTitle,
                body: cancelBody,
                taskTitle: cancelTaskTitle,
                taskId: taskId.toString(),
              },
              idempotencyKey:
                `eh-push:${otherProfile.uid}:${cancelEventKey}:${taskId}:${waMinute}`.slice(0, 200),
            });

            // Legacy messaging-service path (no-op when WHATSAPP_SUPPRESS_LEGACY=true).
            fireWhatsAppNotify({
              uid: otherProfile.uid,
              templateKey: isRequesterCancelled
                ? 'wa_work_cancelled_helper'
                : 'wa_work_cancelled_customer',
              category: 'taskUpdates',
              templateBody: { var_1: cancelTaskTitle },
              templateButtons: taskOpenAppButton(taskId.toString()),
              idempotencyKey: `cancel:${taskId.toString()}:${otherProfile.uid}`,
              metadata: {
                workId: taskId.toString(),
                recipientRole: isRequesterCancelled ? 'helper' : 'customer',
                metaTemplateName: isRequesterCancelled
                  ? 'extrahand_work_cancelled_helper'
                  : 'extrahand_work_cancelled_customer',
              },
            });
          }
        }

        // Notify the performer about the penalty if they cancelled
        if (!isRequesterCancelled && cancellerProfile && cancellerProfile.uid) {
          try {
            await InAppNotificationClient.send({
              userId: cancellerProfile.uid,
              title: 'Cancellation Penalty',
              body: `A penalty has been recorded for cancelling "${task.title}". It will be deducted from your future payouts.`,
              type: 'warning',
              category: 'payments',
              data: {
                taskId: taskId.toString(),
                actionUrl: '/profile?section=payments'
              }
            });
            
            if (cancellerProfile.email) {
               // We will use task_cancelled template but indicating it's about penalty
               EmailServiceClient.sendTaskCancelled(cancellerProfile.email, {
                  recipientName: cancellerProfile.name || cancellerProfile.fullName || "There",
                  taskTitle: task.title,
                  cancelledByName: "You",
                  reason: "A penalty has been applied to your account for this cancellation.",
                  browseUrl: `${config.WEB_APP_URL}/profile?section=payments`,
                  userId: cancellerProfile.uid,
               }).catch(e => logger.error("Penalty email failed", { error: e }));
            }
          } catch (e) {
            logger.error("Penalty notification failed", {
              taskId,
              error: e instanceof Error ? e.message : "Unknown error",
            });
          }
        }
      } catch (error) {
        logger.error("Error sending task_cancelled email", {
          taskId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Email: task started / in_progress â†’ notify requester
    if ((status === "started" || status === "in_progress") && task.status === "assigned") {
      try {
        const Profile = mongoose.connection.collection("profiles");
        const requesterProfile = await Profile.findOne({ _id: task.requesterId });
        const assigneeProfile = task.assigneeId
          ? await Profile.findOne({ _id: task.assigneeId })
          : null;
        if (requesterProfile?.email) {
          EmailServiceClient.sendTaskStarted(requesterProfile.email, {
            requesterName: requesterProfile.name || requesterProfile.fullName || "There",
            assigneeName: assigneeProfile?.name || assigneeProfile?.fullName || "Your tasker",
            taskTitle: task.title,
            startedAt: new Date().toLocaleString(),
            taskUrl: `${config.WEB_APP_URL}/tasks/${taskId}/track`,
            userId: requesterProfile.uid,
          }).catch((err) =>
            logger.error("Error sending task_started email", {
              taskId,
              error: err instanceof Error ? err.message : "Unknown error",
            })
          );
        }
      } catch (error) {
        logger.error("Error sending task_started email", {
          taskId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Email: task completed â†’ notify requester + assignee (when poster marks completed directly)
    if (status === "completed" && task.status !== "completed") {
      try {
        const Profile = mongoose.connection.collection("profiles");
        const requesterProfile = await Profile.findOne({ _id: task.requesterId });
        const assigneeProfile = task.assigneeId
          ? await Profile.findOne({ _id: task.assigneeId })
          : null;
        const completedDateStr = new Date().toLocaleDateString();
        const taskUrl = `${config.WEB_APP_URL}/tasks/${taskId}/track`;
        const reviewUrl = `${config.WEB_APP_URL}/tasks/${taskId}/track`;

        if (requesterProfile?.email) {
          EmailServiceClient.sendTaskCompleted(requesterProfile.email, {
            recipientName: requesterProfile.name || requesterProfile.fullName || "There",
            taskTitle: task.title,
            isTasker: false,
            completedDate: completedDateStr,
            reviewUrl,
            taskUrl,
            userId: requesterProfile.uid,
          }).catch((err) =>
            logger.error("Error sending task_completed email to requester", {
              taskId,
              error: err instanceof Error ? err.message : "Unknown error",
            })
          );

          EmailServiceClient.sendReviewRequest(requesterProfile.email, {
            reviewerName: requesterProfile.name || "There",
            revieweeName: assigneeProfile?.name || assigneeProfile?.fullName || "Your tasker",
            taskTitle: task.title,
            isRequester: true,
            completedDate: completedDateStr,
            reviewUrl,
            userId: requesterProfile.uid,
          }).catch((err) =>
            logger.error("Error sending review_request email", {
              taskId,
              error: err instanceof Error ? err.message : "Unknown error",
            })
          );
        }

        if (assigneeProfile?.email) {
          EmailServiceClient.sendTaskCompleted(assigneeProfile.email, {
            recipientName: assigneeProfile.name || assigneeProfile.fullName || "There",
            taskTitle: task.title,
            isTasker: true,
            completedDate: completedDateStr,
            amount: task.budget?.amount,
            reviewUrl,
            taskUrl,
            userId: assigneeProfile.uid,
          }).catch((err) =>
            logger.error("Error sending task_completed email to assignee", {
              taskId,
              error: err instanceof Error ? err.message : "Unknown error",
            })
          );
        }
      } catch (error) {
        logger.error("Error sending task_completed emails", {
          taskId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      // Auto-request payout immediately after task status set to completed
      const performerUid = updatedTask?.assigneeUid || task.assigneeUid;
      if (updatedTask?.assigneeId && performerUid) {
        try {
          const payoutAmount = typeof task.budget === 'object' ? task.budget.amount : Number(task.budget);
          logger.info(`[Auto-Payout] Initiating auto-payout from updateTaskStatus for task ${taskId}, performer: ${performerUid}, amount: ${payoutAmount}`);
          const payoutResult = await PaymentClient.processTaskCompletionPayout({
            taskId,
            performerUid,
            amount: payoutAmount,
            taskTitle: updatedTask.title || task.title,
            visitId: updatedTask.recurringVisitId ? String(updatedTask.recurringVisitId) : undefined,
          });
          logger.info(`[Auto-Payout] Payout result from updateTaskStatus for task ${taskId}:`, payoutResult);
          
          const bookNowComplete = isBookNowTaskForCompletion(task);
          await InAppNotificationClient.send({
            userId: updatedTask.assigneeId.toString(),
            title: payoutResult.success
              ? bookNowComplete
                ? BOOK_NOW_PARTNER_PAYOUT_COPY.workCompletedTitle
                : 'Payout Initiated'
              : 'Payout Initiation Failed',
            body: payoutResult.success
              ? bookNowComplete
                ? BOOK_NOW_PARTNER_PAYOUT_COPY.workCompletedSoftBody
                : `Task completed. Payout of ₹${payoutAmount} has been initiated automatically.`
              : `Task completed. Payout initiation failed: ${payoutResult.error || 'Please request manually'}.`,
            type: 'info',
            category: 'payments',
            data: {
              taskId,
              actionUrl: '/profile?section=payments',
              eventKey: payoutResult.success
                ? bookNowComplete
                  ? BOOK_NOW_PARTNER_PAYOUT_COPY.pendingVisibilityEventKey
                  : 'PAYOUT_INITIATED'
                : 'PAYOUT_FAILED',
            },
          });
        } catch (paymentError: any) {
          logger.error(`[Auto-Payout] Error processing auto-payout in updateTaskStatus for task ${taskId}:`, paymentError);
        }
      } else {
        logger.warn('[Auto-Payout] Skipping auto-payout in updateTaskStatus: assignee details missing', { taskId });
      }
    }

    TaskService.invalidateTaskCache(taskId);
    return updatedTask as unknown as ITask;
  }

  /**
   * Request or resend task start OTP.
   * OTP is sent to requester (poster) and must be shared with tasker in person.
   */
  static async requestStartOtp(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
    _uid: string,
    options?: { isResend?: boolean }
  ): Promise<{ sentTo: string }> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    const workTask = await RecurringVisitService.resolvePerformingWorkTaskOrSelf(task);
    const effectiveTaskId = String(workTask._id);

    const isPerformer = workTask.assigneeId?.equals(profileId) || false;
    if (!isPerformer) {
      throw new ForbiddenError("Only assigned performer can request start OTP");
    }

    if (workTask.status !== "assigned") {
      throw new BadRequestError("OTP can only be requested when task is in assigned status");
    }

    await RecurringVisitService.ensureVisitPaidBeforeWorkStart(workTask);

    const Profile = mongoose.connection.collection("profiles");
    const requesterProfile = await Profile.findOne({ _id: workTask.requesterId });

    const requesterUid =
      requesterProfile && typeof requesterProfile === "object" && "uid" in requesterProfile
        ? (requesterProfile as { uid?: unknown }).uid
        : undefined;

    if (!requesterUid || typeof requesterUid !== "string") {
      throw new BadRequestError("Requester notification channel unavailable");
    }

    const otp = generateStartOtpCode();
    logger.info(`[OTP] Generated 4-digit start OTP: ${otp} for task: ${effectiveTaskId}`);
    const now = new Date();

    const nextResendCount = options?.isResend
      ? (workTask.startOtp?.resendCount || 0) + 1
      : workTask.startOtp?.resendCount || 0;

    workTask.startOtp = {
      codeHash: otp,
      codePlain: otp,
      requestedAt: now,
      attempts: 0,
      resendCount: nextResendCount,
      requestedById: profileId,
    };
    workTask.executionPhase = "on_the_way";

    await workTask.save();

    const { workTitle: workTitleForOtp, visitNumber } =
      await RecurringVisitService.resolveStartOtpWorkTitle(workTask);

    const journeyTitle = options?.isResend
      ? 'Helper is on the way'
      : 'Helper on the way';
    const journeyBody = options?.isResend
      ? `Your helper is heading to your location for \"${workTitleForOtp}\".`
      : `Your helper has started from their location for \"${workTitleForOtp}\".`;
    const notificationData = {
      taskId: effectiveTaskId,
      taskTitle: workTitleForOtp,
      visitNumber,
      parentTaskId: workTask.parentTaskId ? String(workTask.parentTaskId) : undefined,
      recurringVisitId: workTask.recurringVisitId ? String(workTask.recurringVisitId) : undefined,
      otp,
      otpType: 'task_start',
      eventKey: 'HELPER_ON_THE_WAY',
      entityType: 'task',
      executionPhase: 'on_the_way',
      scheduledLabel: 'soon',
    };

    // Send via both email and in-app notifications for redundancy
    let taskerName = "tasker";
    if (workTask.assigneeId && typeof workTask.assigneeId === "object") {
      try {
        const assigneeId = workTask.assigneeId as mongoose.Types.ObjectId;
        const assigneeProfile = await Profile.findOne({ _id: assigneeId });
        if (assigneeProfile) {
          taskerName = (assigneeProfile as any).name || (assigneeProfile as any).fullName || "tasker";
        }
      } catch (err) {
        logger.warn("Failed to fetch assignee profile for task start OTP", {
          taskId: effectiveTaskId,
          error: err,
        });
      }
    }
    const requesterName = requesterProfile?.name || requesterProfile?.fullName || "requester";
    const requesterEmail =
      requesterProfile && typeof requesterProfile === "object" && "email" in requesterProfile
        ? (requesterProfile as { email?: unknown }).email
        : undefined;

    // Send email
    try {
      if (typeof requesterEmail === "string" && requesterEmail.trim().length > 0) {
        await EmailServiceClient.sendTaskStartOtp(requesterEmail, {
          requesterName,
          taskerName,
          taskTitle: workTitleForOtp,
          otp,
          userId: requesterUid,
        });
      } else {
        logger.warn("Skipping task start OTP email: requester email missing", { taskId, requesterUid });
      }
    } catch (emailError) {
      logger.warn("Failed to send task start OTP via email", { taskId, error: emailError });
    }

    // Push notification (FCM) to poster — journey update (OTP stays in data + Work Progress)
    try {
      await NotificationClient.send({
        eventKey: 'HELPER_ON_THE_WAY',
        category: 'taskUpdates',
        actorId: _uid,
        recipients: [requesterUid],
        entity: { type: 'task', id: taskId },
        title: journeyTitle,
        body: journeyBody,
        data: notificationData,
      });
    } catch (pushError) {
      logger.warn("Failed to send task start OTP via push notification", { taskId, error: pushError });
    }

    // Send in-app notification for immediate visibility
    try {
      await InAppNotificationClient.send({
        userId: requesterUid,
        title: journeyTitle,
        body: journeyBody,
        type: "info",
        category: "taskUpdates",
        data: notificationData,
      });
    } catch (inAppError) {
      logger.warn("Failed to send task start OTP via in-app notification", { taskId, error: inAppError });
    }

    // WhatsApp — Meta template extrahand_work_starting_soon (Dialog + legacy)
    const waMinute = Math.floor(Date.now() / 60000);
    const waIdempotencyKey =
      `eh-push:${requesterUid}:HELPER_ON_THE_WAY:${effectiveTaskId}:${waMinute}`.slice(0, 200);
    fireDialogWhatsAppForUser({
      uid: requesterUid,
      eventKey: 'HELPER_ON_THE_WAY',
      category: 'taskUpdates',
      payload: {
        title: journeyTitle,
        body: journeyBody,
        taskTitle: workTitleForOtp,
        scheduledLabel: 'soon',
        taskId: effectiveTaskId,
        executionPhase: 'on_the_way',
      },
      idempotencyKey: waIdempotencyKey,
    });
    fireWhatsAppNotify({
      uid: requesterUid,
      templateKey: 'wa_work_starting_soon',
      category: 'taskUpdates',
      templateBody: {
        var_1: workTitleForOtp || 'your work',
        var_2: 'soon',
      },
      templateButtons: taskOpenAppButton(String(effectiveTaskId)),
      idempotencyKey: `extrahand_work_starting_soon:journey:${effectiveTaskId}:${requesterUid}`,
      metadata: {
        workId: String(effectiveTaskId),
        triggerType: 'helper_start_journey',
        recipientRole: 'customer',
        metaTemplateName: 'extrahand_work_starting_soon',
      },
    });

    logger.info(`[OTP SUCCESS] Generated and successfully dispatched 4-digit start OTP: ${otp} for task: ${effectiveTaskId} to poster: ${requesterName}`);
    TaskService.invalidateTaskCache(taskId);

    return {
      sentTo: requesterName,
    };
  }

  /**
   * Verify task start OTP and mark task as started.
   */
  static async verifyStartOtp(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
    otp: string
  ): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    const workTask = await RecurringVisitService.resolvePerformingWorkTaskOrSelf(task);
    const effectiveTaskId = String(workTask._id);

    const isPerformer = workTask.assigneeId?.equals(profileId) || false;
    if (!isPerformer) {
      throw new ForbiddenError("Only assigned performer can verify start OTP");
    }

    const currentStatus = String(workTask.status || "").toLowerCase();
    if (currentStatus === "started" || currentStatus === "in_progress") {
      return workTask;
    }

    if (currentStatus !== "assigned") {
      throw new BadRequestError("Task is not in assigned state");
    }

    // Reverted: no additional-quote pending gate in legacy flow.

    const sanitizedOtp = (otp || "").replace(/\D/g, "").slice(0, 4);
    if (sanitizedOtp.length !== 4) {
      throw new BadRequestError("Please enter a valid 4-digit OTP");
    }

    const Profile = mongoose.connection.collection("profiles");
    const posterProfile = await Profile.findOne({ _id: workTask.requesterId });
    const rawPosterUid =
      posterProfile && typeof posterProfile === "object" && "uid" in posterProfile
        ? (posterProfile as { uid?: unknown }).uid
        : undefined;
    const posterUid = typeof rawPosterUid === "string" ? rawPosterUid : undefined;

    if (acceptsPosterDummyStartOtp(posterUid, sanitizedOtp)) {
      logger.warn("start_otp_poster_dummy_accepted", {
        taskId: effectiveTaskId,
        posterUid: posterUid ?? null,
      });
      return TaskService.updateTaskStatus(effectiveTaskId, profileId, "started", {
        skipStartOtpValidation: true,
      });
    }

    if (!workTask.startOtp?.codeHash) {
      throw new BadRequestError("Start OTP not requested. Please request OTP first");
    }

    if ((workTask.startOtp.attempts || 0) >= START_OTP_MAX_ATTEMPTS) {
      throw new BadRequestError("Too many invalid attempts. Please resend OTP");
    }

    if (workTask.startOtp.codeHash !== sanitizedOtp) {
      workTask.startOtp.attempts = (workTask.startOtp.attempts || 0) + 1;
      await workTask.save();

      if (workTask.startOtp.attempts >= START_OTP_MAX_ATTEMPTS) {
        throw new BadRequestError("OTP mismatch. Max attempts reached. Please resend OTP");
      }

      throw new BadRequestError("OTP mismatch");
    }

    workTask.startOtp.verifiedAt = new Date();
    await workTask.save();

    return TaskService.updateTaskStatus(effectiveTaskId, profileId, "started", {
      skipStartOtpValidation: true,
    });
  }

  /**
   * Submit completion proof for review
   */
  static async submitCompletionProof(
    taskId: string,
    uid: string,
    notes?: string
  ): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the assigned performer
    const isAssignedPerformer = task.assigneeId?.toString() === uid;
    let hasAcceptedApplication = false;

    if (!isAssignedPerformer) {
      try {
        const TaskApplication = (await import('../models/TaskApplication')).default;
        const acceptedApplication = await TaskApplication.findOne({
          taskId: task._id,
          applicantUid: uid,
          status: 'accepted'
        });
        hasAcceptedApplication = !!acceptedApplication;
      } catch (error) {
        logger.warn('Could not check applications for performer status:', error);
      }
    }

    if (!isAssignedPerformer && !hasAcceptedApplication) {
      throw new ForbiddenError('Only the assigned performer can submit completion proof');
    }

    // Verify that completion proof exists
    if (!task.completionProof || task.completionProof.length === 0) {
      throw new BadRequestError('Please upload at least one proof image before submitting');
    }

    // Update task to review status
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'review',
        completionStatus: 'pending_approval',
        completionNotes: notes,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedTask) {
      throw new NotFoundError('Task not found');
    }

    logger.info(`Completion proof submitted for task ${taskId} by user ${uid}`);
    TaskService.invalidateTaskCache(taskId);
    return updatedTask as unknown as ITask;
  }

  /**
   * Request changes on a task in review status
   * Only the task requester (poster) can request changes
   */
  static async requestChanges(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
    message: string
  ): Promise<ITask> {
    if (!message || !message.trim()) {
      throw new BadRequestError('Change request message is required');
    }

    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Only requester (poster) can request changes
    const isRequester = task.requesterId.equals(profileId);
    if (!isRequester) {
      throw new ForbiddenError('Only the task requester can request changes');
    }

    // Marketplace: only while pending approval (review).
    // Book Now: from completed within 1 hour of completion (or legacy review).
    const bookNow = isBookNowTaskForCompletion(task);
    if (bookNow) {
      assertBookNowRaiseIssueAllowed(task);
    } else if (task.status !== 'review') {
      throw new BadRequestError('Can only request changes when task is in review status');
    }

    // Move to in_progress + revision_requested so performer can resubmit but cannot withdraw.
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        $push: {
          feedback: {
            message: message.trim(),
            createdById: profileId,
            createdAt: new Date(),
          }
        },
        status: 'in_progress',
        completionStatus: 'revision_requested',
        completionRejectedReason: message.trim(),
        completionRejectedAt: new Date(),
        // Clear current completion markers so Work Progress shows Work Started again.
        // Do NOT clear firstCompletedAt — raise-issue window stays anchored to first complete.
        completedAt: null,
        completionApprovedAt: null,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedTask) {
      throw new NotFoundError('Task not found');
    }

    logger.info(`Change request submitted for task ${taskId} by requester ${profileId.toString()}`);

    if (bookNow) {
      try {
        const holdResult = await PaymentClient.holdBookNowTaskPayouts({
          taskId,
          reason: message.trim(),
        });
        logger.info('[BookNow] Held payouts after change request / raise-issue', {
          taskId,
          success: holdResult.success,
          heldCount: holdResult.heldCount,
          error: holdResult.error,
        });
      } catch (holdError) {
        logger.error('[BookNow] Failed to hold payouts after change request', {
          taskId,
          error: holdError instanceof Error ? holdError.message : String(holdError),
        });
      }
    }

    // Send notification to assignee about the change request
    if (task.assigneeId || task.assigneeUid) {
      try {
        const Profile = mongoose.connection.collection("profiles");
        const requesterProfile = await Profile.findOne({ _id: profileId });
        const assigneeProfile = task.assigneeId
          ? await Profile.findOne({ _id: task.assigneeId })
          : null;

        if (assigneeProfile?.email && requesterProfile?.name) {
          EmailServiceClient.sendChangesRequested(assigneeProfile.email, {
            assigneeName: assigneeProfile.name || assigneeProfile.fullName || "There",
            requesterName: requesterProfile.name || requesterProfile.fullName || "Task Poster",
            taskTitle: task.title,
            message,
            taskUrl: `${config.WEB_APP_URL}/tasks/${taskId}/track`,
            userId: assigneeProfile.uid,
          }).catch((err: Error) =>
            logger.error("Error sending changes_requested email", {
              taskId,
              error: err instanceof Error ? err.message : "Unknown error",
            })
          );
        }

        await notifyHelperRevisionRequested({
          taskId,
          taskTitle: task.title,
          message,
          assigneeId: task.assigneeId,
          assigneeUid: task.assigneeUid,
          posterProfileId: profileId,
        });
      } catch (error) {
        logger.error("Error notifying assignee about change request", {
          taskId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    TaskService.invalidateTaskCache(taskId);
    return updatedTask as unknown as ITask;
  }

  static async createAdditionalQuoteRequest(
    taskId: string,
    performerProfileId: mongoose.Types.ObjectId,
    payload: {
      amount: number;
      reason: string;
      proofImages?: string[];
      // TEMP DISABLED: selfie/work-photo specific fields (kept optional for backward compatibility).
      selfieImage?: string;
      workImage?: string;
    }
  ): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError("Task not found");

    const isPerformer = task.assigneeId?.equals(performerProfileId) || false;
    if (!isPerformer) {
      throw new ForbiddenError("Only assigned performer can request additional payment");
    }
    if (!["assigned", "started", "in_progress"].includes(String(task.status || ""))) {
      throw new BadRequestError("Additional payment request is only allowed before review stage");
    }

    const amount = Number(payload?.amount || 0);
    const reason = String(payload?.reason || "").trim();
    const normalizedProofImages = Array.isArray(payload?.proofImages)
      ? payload.proofImages.map((img) => String(img || "").trim()).filter(Boolean)
      : [];
    // TEMP DISABLED: selfie/work-photo specific parsing.
    // const selfieImage = String(payload?.selfieImage || "").trim();
    // const workImage = String(payload?.workImage || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestError("Valid additional amount is required");
    }
    if (reason.length < 10) {
      throw new BadRequestError("Reason must be at least 10 characters");
    }
    if (normalizedProofImages.length < 1) {
      throw new BadRequestError("At least one proof image is required");
    }

    const pending = getPendingAdditionalQuoteRequest(task);
    if (pending) {
      throw new BadRequestError("A pending additional payment request already exists");
    }

    const requestId = `aqr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const requests = Array.isArray((task as any).additionalQuoteRequests)
      ? ([...(task as any).additionalQuoteRequests] as any[])
      : [];

    requests.push({
      requestId,
      amount,
      reason,
      proofImages: normalizedProofImages,
      // TEMP DISABLED: selfie/work-photo specific persistence.
      // selfieImage,
      // workImage,
      status: "pending",
      createdAt: new Date(),
    });

    const updated = await Task.findByIdAndUpdate(
      taskId,
      {
        additionalQuoteRequests: requests,
        activeAdditionalQuoteRequestId: requestId,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new NotFoundError("Task not found");
    TaskService.invalidateTaskCache(taskId);
    return updated as unknown as ITask;
  }

  static async getAdditionalQuoteRequests(
    taskId: string,
    profileId: mongoose.Types.ObjectId
  ): Promise<any[]> {
    const task = await Task.findById(taskId).lean();
    if (!task) throw new NotFoundError("Task not found");

    const isPerformer = task.assigneeId?.toString() === profileId.toString();
    const isRequester = task.requesterId?.toString() === profileId.toString();
    if (!isPerformer && !isRequester) {
      throw new ForbiddenError("Not authorized to view additional payment requests");
    }

    return Array.isArray((task as any).additionalQuoteRequests)
      ? ((task as any).additionalQuoteRequests as any[])
      : [];
  }

  static async getActiveAdditionalQuoteRequest(
    taskId: string,
    profileId: mongoose.Types.ObjectId
  ): Promise<any | null> {
    const requests = await TaskService.getAdditionalQuoteRequests(taskId, profileId);
    return requests.find((r) => r?.status === "pending") || null;
  }

  static async decideAdditionalQuoteRequest(
    taskId: string,
    requestId: string,
    requesterProfileId: mongoose.Types.ObjectId,
    decision: "accepted" | "rejected",
    decisionReason?: string
  ): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError("Task not found");
    if (!task.requesterId.equals(requesterProfileId)) {
      throw new ForbiddenError("Only task requester can decide additional payment request");
    }

    const requests = Array.isArray((task as any).additionalQuoteRequests)
      ? ([...(task as any).additionalQuoteRequests] as any[])
      : [];
    const index = requests.findIndex((r) => String(r?.requestId) === String(requestId));
    if (index < 0) throw new NotFoundError("Additional payment request not found");
    if (requests[index]?.status !== "pending") {
      throw new BadRequestError("Only pending request can be decided");
    }

    requests[index] = {
      ...requests[index],
      status: decision,
      decidedAt: new Date(),
      decidedById: requesterProfileId,
      decisionReason: decision === "rejected" ? String(decisionReason || "").trim() : undefined,
    };

    const updated = await Task.findByIdAndUpdate(
      taskId,
      {
        additionalQuoteRequests: requests,
        activeAdditionalQuoteRequestId: null,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new NotFoundError("Task not found");
    TaskService.invalidateTaskCache(taskId);
    return updated as unknown as ITask;
  }

  static async withdrawAdditionalQuoteRequest(
    taskId: string,
    requestId: string,
    performerProfileId: mongoose.Types.ObjectId
  ): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError("Task not found");

    const isPerformer = task.assigneeId?.equals(performerProfileId) || false;
    if (!isPerformer) {
      throw new ForbiddenError("Only assigned performer can withdraw additional payment request");
    }

    const requests = Array.isArray((task as any).additionalQuoteRequests)
      ? ([...(task as any).additionalQuoteRequests] as any[])
      : [];
    const index = requests.findIndex((r) => String(r?.requestId) === String(requestId));
    if (index < 0) throw new NotFoundError("Additional payment request not found");
    if (requests[index]?.status !== "pending") {
      throw new BadRequestError("Only pending request can be withdrawn");
    }

    requests[index] = {
      ...requests[index],
      status: "withdrawn",
      decidedAt: new Date(),
      decidedById: performerProfileId,
      decisionReason: "Withdrawn by performer",
    };

    const updated = await Task.findByIdAndUpdate(
      taskId,
      {
        additionalQuoteRequests: requests,
        activeAdditionalQuoteRequestId: null,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new NotFoundError("Task not found");
    TaskService.invalidateTaskCache(taskId);
    return updated as unknown as ITask;
  }

  static async markExecutionArrived(
    taskId: string,
    performerProfileId: mongoose.Types.ObjectId,
    _performerUid: string
  ): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError("Task not found");

    const workTask = await RecurringVisitService.resolvePerformingWorkTaskOrSelf(task);
    const effectiveTaskId = String(workTask._id);

    const isPerformer = workTask.assigneeId?.equals(performerProfileId) || false;
    if (!isPerformer) {
      throw new ForbiddenError("Only assigned performer can mark arrival");
    }

    if (workTask.status !== "assigned") {
      throw new BadRequestError("Task must be in assigned state to mark arrival");
    }

    if (workTask.executionPhase !== "on_the_way") {
      throw new BadRequestError("Helper journey must be started (on the way) to mark arrival");
    }

    const updated = await Task.findByIdAndUpdate(
      effectiveTaskId,
      {
        executionPhase: "arrived",
        arrivedAt: new Date(),
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new NotFoundError("Task not found");
    TaskService.invalidateTaskCache(effectiveTaskId);
    return updated as unknown as ITask;
  }

  static async getStartOtpForPoster(
    taskId: string,
    posterProfileId: mongoose.Types.ObjectId
  ): Promise<{ otp: string | null; executionPhase: string | null }> {
    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError("Task not found");

    const workTask = await RecurringVisitService.resolvePerformingWorkTaskOrSelf(task);

    const isRequester = workTask.requesterId.equals(posterProfileId);
    if (!isRequester) {
      throw new ForbiddenError("Only the task requester can view the start OTP");
    }

    const startOtp = workTask.startOtp;
    return {
      otp: startOtp?.codePlain || null,
      executionPhase: workTask.executionPhase || null,
    };
  }
}
