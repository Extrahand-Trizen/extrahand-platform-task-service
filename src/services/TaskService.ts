import mongoose from "mongoose";
import crypto from "crypto";
import Task, { ITask } from "../models/Task";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../errors/AppError";
import logger from "../config/logger";
import { TaskCategory, TaskStatus } from "../types";
import { NotificationClient } from "./NotificationClient";
import { UserMatchingService } from "./UserMatchingService";
import { UserServiceClient } from "../clients/UserServiceClient";
import { EmailServiceClient } from "../clients/EmailServiceClient";
import { InAppNotificationClient } from "../clients/InAppNotificationClient";
import { fireWhatsAppNotify } from "../clients/WhatsAppClient";
import { taskOpenAppButton } from "../utils/whatsappTaskButtons";
import { buildScheduleVersion } from "../utils/workSchedule";
import TaskApplication from "../models/TaskApplication";
import { MainAdminNotificationClient } from "../clients/MainAdminNotificationClient";
import { NotificationPreferenceChecker } from "./NotificationPreferenceChecker";
import { PaymentClient } from "./PaymentClient";
import { config } from "../config/env";
import { emitTaskStatusChanged } from '../socket/socketHandlers';
import { getRedisClient, REDIS_TTLS } from '../config/redis';
import { acceptsPosterDummyStartOtp } from '../utils/startOtpBypass';
import { getMeaningfulTextError } from '../utils/textValidation';
import { isActiveEscrow } from '../utils/taskCommitment';
import {
  excludeTaskPoster,
  resolvePosterUid,
  withHelperAlertData,
} from '../utils/helperNotificationRecipients';

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
    `⚠️ Unknown category: "${frontendCategory}", defaulting to "other"`
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
  'title category categorySlug categoryLabel subcategory budget isNegotiable location status urgency priority requesterId assigneeId assignedAt views isFeatured expiresAt scheduledDate dateOption timeSlot flexibility createdAt updatedAt packersMoversDetails groceryPickupDetails medicinePickupDetails pickDropDetails images bookingSource bookingOrderId';

/** Post & Choose only — Book Now tasks are assigned via ops, not helper browse. */
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

const START_OTP_TTL_MS = 10 * 60 * 1000;
const START_OTP_MAX_ATTEMPTS = 5;

function generateStartOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashStartOtp(taskId: string, otp: string): string {
  return crypto.createHash("sha256").update(`${taskId}:${otp}`).digest("hex");
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
    limit?: number;
    page?: number;
  }): Promise<{ tasks: ITask[]; pagination: any }> {
    const { status, excludeOverdue, category, city, minBudget, maxBudget, search, suburb, remotely, sortBy, sortOrder, excludeRequesterId, assigneeId, posterUid, requesterId, bookingSource, limit = 50, page = 1 } = filters;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, page), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;

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
        andClauses.push({ bookingSource: 'book_now' });
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
    }

    // Status filter: support single value or array (e.g. "open,assigned" sent as array)
    if (status) {
      if (status === 'overdue') {
        const now = new Date();
        andClauses.push({ status: 'open' });
        andClauses.push({ scheduledDate: { $lt: now } });
        andClauses.push({ dateOption: { $ne: 'flexible' } });
      } else if (status === 'open' && (excludeOverdue === true || excludeOverdue === 'true')) {
        const now = new Date();
        andClauses.push({ status: 'open' });
        andClauses.push({
          $or: [
            { scheduledDate: { $exists: false } },
            { scheduledDate: null },
            { dateOption: 'flexible' },
            { scheduledDate: { $gte: now } }
          ]
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

    // Filter by requester profile ID
    if (requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
      andClauses.push({ requesterId: new mongoose.Types.ObjectId(requesterId) });
    }

    // Filter by poster UID (for posted tasks)
    if (posterUid) {
      andClauses.push({ posterUid: posterUid });
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
      // remotely === false: in-person filter — don't strictly exclude tasks without coordinates
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
    const radiusMeters = radiusKm * 1000;

    const andClauses: any[] = [];

    // Book Now tasks are ops-assigned — exclude from helper browse/nearby.
    andClauses.push(buildMarketplaceBrowseClause());

    // Include nearby tasks (with coordinates) OR remote/packers-movers tasks (without coordinates)
    // This ensures tasks like packers-movers that don't have a fixed location are always shown
    andClauses.push({
      $or: [
        {
          "location.coordinates": {
            $near: {
              $geometry: {
                type: "Point",
                coordinates: [lng, lat],
              },
              $maxDistance: radiusMeters,
            },
          },
        },
        // Tasks without coordinates (remote tasks, packers-movers, etc.)
        { "location.coordinates.0": { $exists: false } },
        { location: { $exists: false } },
      ],
    });

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
      // remotely === false: in-person filter — but still include packers-movers (no coordinates)
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

    // NOTE: countDocuments with $near can fail on some MongoDB versions/tiers.
    // Use $geoWithin + $centerSphere for count instead.
    const countAndClauses = andClauses.map((clause) => {
      if (!clause["location.coordinates"]?.$near) return clause;
      return {
        "location.coordinates": {
          $geoWithin: {
            $centerSphere: [[lng, lat], radiusKm / 6378.1], // Earth radius in km
          },
        },
      };
    });
    const total = await Task.countDocuments({
      $and: countAndClauses,
    });

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
    }
  ): Promise<{ tasks: ITask[]; pagination: any }> {
    const { status, limit = 50, page = 1 } = filters;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, page), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;

    const query: any = { requesterId: profileId }; // ✅ ObjectId reference
    if (status) query.status = status;

    const tasks = await Task.find(query)
      .select(TASK_LIST_SELECT)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(effectiveLimit)
      .lean();

    const total = await Task.countDocuments(query);

    return {
      tasks: tasks as unknown as ITask[],
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
      ...buildLiveOpenExpiryClause(new Date()),
    });
  }

  /**
   * Get a single task by ID (with Redis cache to reduce DB load under concurrency)
   */
  static async getTaskById(taskId: string): Promise<ITask> {
    const cacheKey = `task:detail:${taskId}`;
    try {
      const redis = getRedisClient();
      if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as ITask;
          logger.debug("Task detail cache HIT", { taskId });
          return parsed;
        }
      }
    } catch (err) {
      logger.warn("Task detail cache read error", { taskId, error: err instanceof Error ? err.message : String(err) });
    }

    const task = await Task.findById(taskId).lean();
    if (!task) {
      throw new NotFoundError("Task not found");
    }
    const result = task as unknown as ITask;

    try {
      const redis = getRedisClient();
      if (redis) {
        await redis.setex(cacheKey, REDIS_TTLS.TASK_DETAIL_SECONDS, JSON.stringify(result));
        logger.debug("Task detail cache SET", { taskId });
      }
    } catch (err) {
      logger.warn("Task detail cache write error", { taskId, error: err instanceof Error ? err.message : String(err) });
    }

    return result;
  }

  /**
   * Invalidate cached task so next getTaskById fetches fresh from DB (call after update/delete)
   */
  static invalidateTaskCache(taskId: string): void {
    const cacheKey = `task:detail:${taskId}`;
    getRedisClient()?.del(cacheKey).catch((err: any) => {
      logger.warn("Task detail cache invalidate error", { taskId, error: err instanceof Error ? err.message : String(err) });
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
    // Delivery/pickup tasks have system-generated titles and descriptions — skip meaningful-text checks
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
      `🔍 Category mapping: "${frontendCategory}" → "${mappedCategory}"`
    );

    // ❌ Removed requesterName handling - will be populated from Profile when needed

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

      location = {
        type: "Point" as const,
        // Only set coordinates if we have valid non-zero values
        ...(coords && coords[0] !== 0 && coords[1] !== 0 ? { coordinates: coords } : {}),
        address: taskData.location.address || taskData.location || undefined,
        city: taskData.location.city || taskData.city || undefined,
        state: taskData.location.state || taskData.state || undefined,
        country: taskData.location.country || taskData.country || "India",
      };
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
      requesterId: profileId, // ✅ ObjectId reference
      // ❌ Removed requesterName - API Gateway will enrich with Profile data
      estimatedDuration: taskData.estimatedDuration || taskData.duration,
      scheduledDate: taskData.scheduledDate
        ? typeof taskData.scheduledDate === "string"
          ? new Date(taskData.scheduledDate)
          : taskData.scheduledDate
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
    if (recurring?.enabled) {
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

    // Only include location if it was provided
    if (location) {
      taskPayload.location = location;
    }

    // ── Packers & Movers specific fields ──────────────────────────────────────
    // Only store when category is packers-movers — no impact on other categories
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

    // ── Delivery / Pickup specific fields ──────────────────────────────────────
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

    logger.info(`✅ Task created successfully: ${task._id}`);

    // Verify the created task has the correct requesterId
    logger.info(`[TaskService.createTask] Task created with requesterId`, {
      taskId: task._id,
      requesterId: task.requesterId,
      requesterIdType: typeof task.requesterId,
      isObjectId: task.requesterId instanceof mongoose.Types.ObjectId
    });

    // Check if the requester profile actually exists
    try {
      const ProfilesCol = mongoose.connection.collection("profiles");
      const requesterProfile = await ProfilesCol.findOne({ _id: task.requesterId });

      logger.info(`[TaskService.createTask] Requester profile lookup`, {
        taskId: task._id,
        requesterId: task.requesterId.toString(),
        profileExists: !!requesterProfile,
        profileName: requesterProfile?.name || requesterProfile?.fullName || 'NOT FOUND'
      });
    } catch (error) {
      logger.warn(`[TaskService.createTask] Could not verify requester profile`, {
        taskId: task._id,
        requesterId: task.requesterId.toString(),
        error: error instanceof Error ? error.message : String(error)
      });
    }

    let requesterProfile: Record<string, any> | null = null;
    try {
      const Profile = mongoose.connection.collection("profiles");
      const requesterId = task.requesterId instanceof mongoose.Types.ObjectId
        ? task.requesterId
        : new mongoose.Types.ObjectId(task.requesterId);
      requesterProfile = await Profile.findOne({ _id: requesterId });
    } catch (profileLookupError) {
      logger.warn("[TaskService.createTask] Requester profile lookup failed", {
        taskId: task._id,
        requesterId: task.requesterId?.toString?.() ?? task.requesterId,
        error:
          profileLookupError instanceof Error
            ? profileLookupError.message
            : String(profileLookupError),
      });
    }

    try {
      logger.info("[TaskPostedInAppNotification][task-service] Task created — triggering ops in-app notification", {
        service: "extrahand-platform-task-service",
        taskId: String(task._id),
        taskTitle: task.title,
        budget: task.budget?.amount,
      });

      await MainAdminNotificationClient.send({
        type: "task_posted",
        taskId: String(task._id),
        taskTitle: task.title,
        userId: requesterProfile?.uid,
        userName: requesterProfile?.name || requesterProfile?.fullName,
        userEmail: requesterProfile?.email,
        userPhone: requesterProfile?.phone,
        occurredAt: new Date().toISOString(),
      });

      logger.info("[TaskPostedInAppNotification][task-service] Ops in-app notification flow completed for task", {
        service: "extrahand-platform-task-service",
        taskId: String(task._id),
        taskTitle: task.title,
      });
    } catch (adminNotifyError) {
      logger.error("[TaskPostedInAppNotification][task-service] Ops in-app notification flow failed for task", {
        service: "extrahand-platform-task-service",
        taskId: String(task._id),
        taskTitle: task.title,
        error:
          adminNotifyError instanceof Error
            ? adminNotifyError.message
            : String(adminNotifyError),
      });
    }

    // Email: task posted confirmation → requester
    try {
      if (requesterProfile?.email) {
        logger.debug(`[TaskService.createTask] Sending task_posted_confirmation email to ${requesterProfile.email}`);
        const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
        const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
          requesterProfile.uid,
          'taskUpdates'
        );

        if (emailEnabled) {
          await EmailServiceClient.sendTaskPostedConfirmation(requesterProfile.email, {
            requesterName: requesterProfile.name || requesterProfile.fullName || 'There',
            taskTitle: task.title,
            taskUrl,
            budget: task.budget?.amount,
            category: mappedCategory,
            location: task.location?.city || task.location?.address,
            userId: requesterProfile.uid,
          });
          logger.info(`[TaskService.createTask] task_posted_confirmation email sent successfully`, {
            taskId: task._id,
            to: requesterProfile.email,
            userId: requesterProfile.uid
          });
        } else {
          logger.info(`[TaskService.createTask] task_posted_confirmation email skipped - preferences disabled`, {
            taskId: task._id,
            userId: requesterProfile.uid,
            category: 'taskUpdates'
          });
        }

        // 📬 In-App Notification: task posted confirmation → requester
        try {
          await InAppNotificationClient.send({
            userId: requesterProfile.uid,
            title: '✅ Task Posted Successfully',
            body: `Your task "${task.title}" is now visible to taskers`,
            category: 'taskUpdates',
            type: 'success',
            data: {
              taskId: task._id.toString(),
              taskUrl,
              budget: task.budget?.amount
            }
          });
          logger.info(`[TaskService.createTask] In-app notification sent to requester`, {
            taskId: task._id,
            userId: requesterProfile.uid
          });
        } catch (inAppError) {
          logger.warn('Failed to send in-app notification to requester', {
            taskId: task._id,
            userId: requesterProfile.uid,
            error: inAppError instanceof Error ? inAppError.message : 'Unknown error'
          });
        }
      } else {
        logger.debug(`[TaskService.createTask] No email found for requester profile`, {
          requesterId: task.requesterId
        });
      }
    } catch (error) {
      logger.error("Error sending task_posted_confirmation email", {
        taskId: task._id,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    const posterUid = resolvePosterUid(uid, requesterProfile);

    const skillMatchCategories = Array.from(
      new Set(
        [
          task.subcategory,
          task.categorySlug,
          categorySlug,
          task.categoryLabel,
          task.category,
          frontendCategory,
          mappedCategory,
        ].filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        ),
      ),
    );

    const skillMatchCategory = skillMatchCategories[0];

    let skillMatchedTaskers: string[] = [];
    let nearbyTaskers: string[] = [];

    if (posterUid) {
      try {
        if (skillMatchCategories.length > 0) {
          const skillMatchedUsersRaw = await UserServiceClient.matchSkillCategories(
            skillMatchCategories,
          );
          skillMatchedTaskers = excludeTaskPoster(skillMatchedUsersRaw, posterUid);
        }

        const coords: [number, number] | undefined = task?.location?.coordinates;
        const hasValidCoords =
          Array.isArray(coords) &&
          coords.length === 2 &&
          typeof coords[0] === 'number' &&
          typeof coords[1] === 'number';

        if (hasValidCoords) {
          nearbyTaskers = await UserServiceClient.matchNearbyTaskers({
            longitude: coords[0],
            latitude: coords[1],
            excludeUids: [posterUid],
          });

          // Fallback to direct DB geo match if user-service is unreachable.
          if (nearbyTaskers.length === 0) {
            nearbyTaskers = await UserMatchingService.findNearbyTaskers(
              task,
              undefined,
              [posterUid],
            );
          }
        } else {
          logger.warn('[TaskService.createTask] Task missing coordinates for nearby alerts', {
            taskId: task._id,
            coordinates: coords,
          });
        }

        logger.info('[TaskService.createTask] Helper discovery recipient lookup', {
          taskId: task._id,
          skillMatchCategories,
          skillMatchedCount: skillMatchedTaskers.length,
          nearbyCount: nearbyTaskers.length,
          hasCoordinates: hasValidCoords,
        });
      } catch (matchErr) {
        logger.warn('[TaskService.createTask] Helper alert recipient lookup failed', {
          taskId: task._id,
          error: matchErr instanceof Error ? matchErr.message : 'Unknown error',
        });
      }
    }

    const nearbyTaskerSet = new Set(nearbyTaskers);
    const skillMatchedSet = new Set(skillMatchedTaskers);

    // STEP 1: Emit TASK_CREATED_RECOMMENDED notification
    // Skill-matched helpers who are NOT nearby (nearby helpers get TASK_NEARBY instead).
    if (posterUid) {
      try {
        const recommendedTaskers = skillMatchedTaskers.filter(
          (matchedUid) => !nearbyTaskerSet.has(matchedUid),
        );

        logger.info('[TaskService.createTask] CATEGORY_SKILL_ALERTS - Matched users by category only', {
          taskId: task._id,
          skillMatchCategory,
          category: mappedCategory,
          matchedCount: recommendedTaskers.length,
          matchedUsers: recommendedTaskers,
          excludedRequesterUid: posterUid,
        });

        if (recommendedTaskers.length > 0) {
          const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
          const taskRoute = `/tasks/${task._id}`;

          const recommendedLocationLabel =
            task.location?.city ||
            task.location?.address ||
            'your area';

          await NotificationClient.sendBatch(
            {
              eventKey: 'TASK_CREATED_RECOMMENDED',
              category: 'recommendedTaskAlerts',
              actorId: posterUid,
              entity: { type: 'task', id: task._id.toString() },
              title: `New skill matched nearby: ${task.title}`,
              body: `A ${skillMatchCategory} task has been posted near ${recommendedLocationLabel} and matches your skills.`,
              data: withHelperAlertData({
                eventKey: 'TASK_CREATED_RECOMMENDED',
                entityType: 'task',
                skillMatch: true,
                taskId: task._id.toString(),
                category: mappedCategory,
                skillMatchCategory,
                budget: task.budget.amount,
                locationLabel: recommendedLocationLabel,
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
              }, posterUid),
            },
            recommendedTaskers
          );

          // In-app notification must be delivered directly to all matched UIDs.
          for (const matchedUid of recommendedTaskers) {
            try {
              await InAppNotificationClient.send({
                userId: matchedUid,
                title: '🎯 New Skill Matched Nearby',
                body: `A new "${skillMatchCategory}" task "${task.title}" has been posted near ${recommendedLocationLabel}`,
                category: 'recommendedTaskAlerts',
                type: 'info',
                data: {
                  taskId: task._id.toString(),
                  taskUrl,
                  route: taskRoute,
                  actionUrl: taskRoute,
                  category: mappedCategory,
                  skillMatchCategory,
                  budget: task.budget?.amount,
                  locationLabel: recommendedLocationLabel,
                }
              });
              logger.info('[TaskService.createTask] CATEGORY_SKILL_ALERTS - In-app sent (uid-level)', {
                taskId: task._id,
                userId: matchedUid,
                category: mappedCategory,
                route: taskRoute,
              });
            } catch (inAppError) {
              logger.warn('[TaskService.createTask] CATEGORY_SKILL_ALERTS - In-app failed (uid-level)', {
                taskId: task._id,
                userId: matchedUid,
                error: inAppError instanceof Error ? inAppError.message : 'Unknown error'
              });
            }
          }

          // Email: task_created_recommended → matched taskers
          try {
            const Profile = mongoose.connection.collection('profiles');

            // ✅ FIX: query profiles by uid (string), not _id (ObjectId)
            const recommendedProfiles = await Profile.find({ uid: { $in: recommendedTaskers } }).toArray();
            const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;

            logger.info('[TaskService.createTask] CATEGORY_SKILL_ALERTS - Profile lookup for email', {
              taskId: task._id,
              matchedUidCount: recommendedTaskers.length,
              profileCount: recommendedProfiles.length,
            });

            for (const p of recommendedProfiles) {
              if (!p?.uid || p.uid === posterUid) {
                logger.debug('[TaskService.createTask] CATEGORY_SKILL_ALERTS - Skipping invalid/owner recipient', {
                  taskId: task._id,
                  uid: p?.uid,
                });
                continue;
              }

              // Email for category-matched recipient (if email exists and preference enabled).
              if (p.email) {
                try {
                  logger.debug(`[TaskService.createTask] Sending task_created_recommended email to ${p.email}`);
                  const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                    p.uid,
                    'recommendedTaskAlerts'
                  );

                  if (emailEnabled) {
                    await EmailServiceClient.sendTaskCreatedRecommended(p.email, {
                      taskerName: p.name || p.fullName || 'There',
                      taskTitle: task.title,
                      skillCategory: mappedCategory,
                      taskDescription: task.description?.substring(0, 200),
                      budget: task.budget?.amount,
                      location: task.location?.city || task.location?.address,
                      scheduledDate: scheduledDateStr,
                      category: mappedCategory,
                      taskUrl,
                      userId: p.uid,
                    });
                    logger.info('[TaskService.createTask] CATEGORY_SKILL_ALERTS - Email sent', {
                      taskId: task._id,
                      to: p.email,
                      userId: p.uid,
                      category: mappedCategory,
                    });
                  } else {
                    logger.info('[TaskService.createTask] CATEGORY_SKILL_ALERTS - Email skipped by preferences', {
                      taskId: task._id,
                      userId: p.uid,
                      category: 'recommendedTaskAlerts',
                    });
                  }
                } catch (err) {
                  logger.error('Error sending task_created_recommended email to user', {
                    taskId: task._id,
                    email: p.email,
                    userId: p.uid,
                    error: err instanceof Error ? err.message : 'Unknown error',
                    stack: err instanceof Error ? err.stack : undefined
                  });
                }
              } else {
                logger.info('[TaskService.createTask] CATEGORY_SKILL_ALERTS - Email skipped (missing email)', {
                  taskId: task._id,
                  userId: p.uid,
                });
              }
            }
          } catch (emailErr) {
            logger.error('Error sending task_created_recommended emails', {
              taskId: task._id,
              error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
              stack: emailErr instanceof Error ? emailErr.stack : undefined
            });
          }
        }
      } catch (error) {
        logger.error('Error sending TASK_CREATED_RECOMMENDED notification', {
          taskId: task._id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // STEP 2: Emit TASK_CREATED_KEYWORD notification
      // Find users who have saved keywords matching this task (ONLY matching category, not title/description)
      try {
        // Extract search keywords from category plus the user-facing title/label.
        // This lets keyword alerts fire even when the skill category does not match.
        const taskKeywords: string[] = [
          task.category?.toLowerCase(),
          task.subcategory?.toLowerCase(),
          task.categoryLabel?.toLowerCase(),
          task.title?.toLowerCase(),
        ]
          .filter((word): word is string => typeof word === 'string' && word.length > 0)
          .flatMap((word) => [
            word,
            word.replace(/\//g, ' '),
            word.replace(/\s+/g, ' ').trim(),
          ])
          .map((word) => word.toLowerCase().trim())
          .filter((word, index, arr) => word.length > 0 && arr.indexOf(word) === index);

        logger.info(`[TaskService.createTask] KEYWORD ALERTS - Extracted keywords`, {
          taskId: task._id,
          keywords: taskKeywords,
          keywordCount: taskKeywords.length,
          taskTitle: task.title.substring(0, 50),
          category: task.category,
          categoryLabel: task.categoryLabel
        });

        if (taskKeywords.length > 0) {
          logger.info(`[TaskService.createTask] KEYWORD ALERTS - Querying for matched users`, {
            taskId: task._id,
            keywords: taskKeywords
          });

          const keywordMatchedUsersRaw = await UserServiceClient.matchUsers('keywords', {
            keywords: taskKeywords,
          });
          const keywordMatchedUsers = excludeTaskPoster(keywordMatchedUsersRaw, posterUid);

          logger.info('[TaskService.createTask] KEYWORD ALERTS - Matched users by keyword only', {
            taskId: task._id,
            keywords: taskKeywords,
            matchedCount: keywordMatchedUsers.length,
            matchedUsers: keywordMatchedUsers,
            excludedRequesterUid: posterUid,
          });

          logger.info(`[TaskService.createTask] KEYWORD ALERTS - User matching result`, {
            taskId: task._id,
            matchedUserCount: keywordMatchedUsers.length,
            matchedUsers: keywordMatchedUsers,
            keywords: taskKeywords
          });

          if (keywordMatchedUsers.length > 0) {
            await NotificationClient.sendBatch(
              {
                eventKey: 'TASK_CREATED_KEYWORD',
                category: 'keywordTaskAlerts',
                actorId: posterUid,
                entity: { type: 'task', id: task._id.toString() },
                title: `Alert: Task matches your saved keywords`,
                body: `A new task has been posted with keywords you're interested in: ${taskKeywords.slice(0, 2).join(', ')}`,
                data: {
                  taskId: task._id.toString(),
                  matchedKeywords: taskKeywords.slice(0, 5),
                  posterUid,
                  actorId: posterUid,
                },
              },
              keywordMatchedUsers
            );
            // Email: task_created_keyword → keyword-matched users
            try {
              const Profile = mongoose.connection.collection('profiles');
              const keywordProfiles = await Profile.find({ uid: { $in: keywordMatchedUsers } }).toArray();

              logger.info(`[TaskService.createTask] KEYWORD ALERTS - Fetched profiles`, {
                taskId: task._id,
                fetchedProfileCount: keywordProfiles.length,
                profilesWithEmail: keywordProfiles.filter(p => p.email).length
              });

              const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
              const taskRoute = `/tasks/${task._id}`;
              const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;
              const matchedKeywordStr = taskKeywords.slice(0, 2).join(', ');

              for (const p of keywordProfiles) {
                // Skip the task creator - they should not receive alerts for their own tasks
                if (p.uid === posterUid) {
                  logger.info(`[TaskService.createTask] KEYWORD ALERTS - Skipping task creator`, {
                    taskId: task._id,
                    creatorId: posterUid
                  });
                  continue;
                }

                logger.debug(`[TaskService.createTask] KEYWORD ALERTS - Processing profile`, {
                  taskId: task._id,
                  uid: p.uid,
                  name: p.name,
                  hasEmail: !!p.email,
                  email: p.email?.substring(0, 10) + '***' // Mask email for logs
                });

                if (p.email) {
                  try {
                    logger.debug(`[TaskService.createTask] KEYWORD ALERTS - Checking email preference`);
                    // Check if user has enabled keyword alert emails
                    const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                      p.uid,
                      'keywordTaskAlerts'
                    );

                    logger.info(`[TaskService.createTask] KEYWORD ALERTS - Email preference check result`, {
                      taskId: task._id,
                      userId: p.uid,
                      emailEnabled,
                      email: p.email?.substring(0, 10) + '***'
                    });

                    if (emailEnabled) {
                      logger.info(`[TaskService.createTask] KEYWORD ALERTS - Sending email`);
                      await EmailServiceClient.sendTaskCreatedKeyword(p.email, {
                        userName: p.name || p.fullName || 'There',
                        taskTitle: task.title,
                        matchedKeyword: matchedKeywordStr,
                        taskDescription: task.description?.substring(0, 200),
                        budget: task.budget?.amount,
                        location: task.location?.city || task.location?.address,
                        scheduledDate: scheduledDateStr,
                        taskUrl,
                        userId: p.uid,
                      });
                      logger.info(`[TaskService.createTask] KEYWORD ALERTS - Email sent successfully`, {
                        taskId: task._id,
                        to: p.email?.substring(0, 10) + '***',
                        userId: p.uid,
                        keywords: taskKeywords.slice(0, 3)
                      });

                      // 📬 In-App Notification: keyword alert → user
                      try {
                        await InAppNotificationClient.send({
                          userId: p.uid,
                          title: '🔔 Task Found: ' + matchedKeywordStr,
                          body: `A new task "${task.title}" matches your keywords`,
                          category: 'keywordTaskAlerts',
                          type: 'info',
                          data: {
                            taskId: task._id.toString(),
                            taskUrl,
                            route: taskRoute,
                            actionUrl: taskRoute,
                            keywords: taskKeywords,
                            matchedKeyword: matchedKeywordStr,
                            budget: task.budget?.amount
                          }
                        });
                        logger.info(`[TaskService.createTask] KEYWORD ALERTS - In-app notification sent`, {
                          taskId: task._id,
                          userId: p.uid,
                          keywords: taskKeywords.slice(0, 3)
                        });
                      } catch (inAppError) {
                        logger.warn('Failed to send in-app notification for keyword alert', {
                          taskId: task._id,
                          userId: p.uid,
                          error: inAppError instanceof Error ? inAppError.message : 'Unknown error'
                        });
                      }
                    } else {
                      logger.warn(`[TaskService.createTask] KEYWORD ALERTS - Email notifications disabled for user`, {
                        taskId: task._id,
                        userId: p.uid,
                        category: 'keywordTaskAlerts'
                      });
                    }
                  } catch (err) {
                    logger.error('Error sending task_created_keyword email to user', {
                      taskId: task._id,
                      email: p.email?.substring(0, 10) + '***',
                      userId: p.uid,
                      error: err instanceof Error ? err.message : 'Unknown error',
                      stack: err instanceof Error ? err.stack : undefined
                    });
                  }
                } else {
                  logger.warn(`[TaskService.createTask] KEYWORD ALERTS - Profile has no email`, {
                    taskId: task._id,
                    userId: p.uid,
                    name: p.name
                  });
                }
              }
            } catch (emailErr) {
              logger.error('Error sending task_created_keyword emails', {
                taskId: task._id,
                error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
                stack: emailErr instanceof Error ? emailErr.stack : undefined
              });
            }
          } else {
            logger.warn(`[TaskService.createTask] KEYWORD ALERTS - No matched users found`, {
              taskId: task._id,
              keywords: taskKeywords
            });
          }
        } else {
          logger.warn(`[TaskService.createTask] KEYWORD ALERTS - No keywords extracted`, {
            taskId: task._id,
            taskTitle: task.title
          });
        }
      } catch (error) {
        logger.error('Error sending TASK_CREATED_KEYWORD notification', {
          taskId: task._id,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
      }

      // STEP 3: Emit TASK_CREATED_CATEGORY notification
      // Find users who have saved category matching this task
      try {
        // Create category slugs based on task category
        // Map simple backend categories to content-admin style slugs
        const categorySlugs = [
          task.categorySlug,
          task.category,
          task.subcategory,
        ]
          .map((slug) => (slug ? slug.toString().toLowerCase().trim() : ""))
          .filter((slug) => slug.length > 0);

        if (categorySlugs.length > 0) {
          const categoryMatchedUsers: string[] = [];

          logger.info('[TaskService.createTask] CATEGORY_SKILL_ALERTS - Category-slug pipeline remains disabled', {
            taskId: task._id,
            categorySlugs,
          });

          if (categoryMatchedUsers.length > 0) {
            await NotificationClient.sendBatch(
              {
                eventKey: 'TASK_CREATED_CATEGORY',
                category: 'keywordTaskAlerts', // Using same category preference
                actorId: posterUid,
                entity: { type: 'task', id: task._id.toString() },
                title: `New ${task.categoryLabel || task.category} task posted!`,
                body: `A new ${task.categoryLabel || task.category} task has been posted: ${task.title.substring(0, 50)}${task.title.length > 50 ? '...' : ''}`,
                data: withHelperAlertData({
                  taskId: task._id.toString(),
                  category: task.categoryLabel || task.category,
                }, posterUid),
              },
              categoryMatchedUsers
            );

            // Email: task_created_category → category-matched users
            try {
              const Profile = mongoose.connection.collection('profiles');
              const categoryProfiles = await Profile.find({ uid: { $in: categoryMatchedUsers } }).toArray();
              const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
              const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;
              const categoryLabel = task.categoryLabel || task.subcategory || task.category;

              for (const p of categoryProfiles) {
                if (p.email) {
                  try {
                    logger.debug(`[TaskService.createTask] Sending task_created_category email to ${p.email}`);
                    // Check if user has enabled keyword alert emails
                    const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                      p.uid,
                      'keywordTaskAlerts'
                    );

                    if (emailEnabled) {
                      await EmailServiceClient.sendTaskCreatedKeyword(p.email, {
                        userName: p.name || p.fullName || 'There',
                        taskTitle: task.title,
                        matchedKeyword: categoryLabel,
                        taskDescription: task.description?.substring(0, 200),
                        budget: task.budget?.amount,
                        location: task.location?.city || task.location?.address,
                        scheduledDate: scheduledDateStr,
                        taskUrl,
                        userId: p.uid,
                      });
                      logger.info(`[TaskService.createTask] task_created_category email sent successfully`, {
                        taskId: task._id,
                        to: p.email,
                        userId: p.uid,
                        category: categoryLabel
                      });
                    } else {
                      logger.info(`[TaskService.createTask] Email notifications disabled for keyword alerts`, {
                        userId: p.uid
                      });
                    }
                  } catch (err) {
                    logger.error('Error sending task_created_category email to user', {
                      taskId: task._id,
                      email: p.email,
                      userId: p.uid,
                      error: err instanceof Error ? err.message : 'Unknown error',
                      stack: err instanceof Error ? err.stack : undefined
                    });
                  }
                }
              }
            } catch (emailErr) {
              logger.error('Error sending task_created_category emails', {
                taskId: task._id,
                error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
                stack: emailErr instanceof Error ? emailErr.stack : undefined
              });
            }
          }
        }
      } catch (error) {
        logger.error('Error sending TASK_CREATED_CATEGORY notification', {
          taskId: task._id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } else {
      logger.warn('Skipping helper discovery notifications - poster uid not resolved', {
        taskId: task._id,
        profileId: profileId.toString()
      });
    }

    // STEP 4: Emit TASK_NEARBY notification
    // One alert per nearby helper (skill wording when applicable).
    try {
      if (nearbyTaskers.length > 0) {
        const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
        const taskRoute = `/tasks/${task._id}`;
        const locationLabel =
          task.location?.city ||
          task.location?.address ||
          'your area';

        const nearbyAndSkill = excludeTaskPoster(
          nearbyTaskers.filter((u) => skillMatchedSet.has(u)),
          posterUid,
        );
        const nearbyOnly = excludeTaskPoster(
          nearbyTaskers.filter((u) => !skillMatchedSet.has(u)),
          posterUid,
        );

        if (nearbyAndSkill.length > 0) {
          await NotificationClient.sendBatch(
            {
              eventKey: 'TASK_NEARBY',
              category: 'recommendedTaskAlerts',
              actorId: posterUid,
              entity: { type: 'task', id: task._id.toString() },
              title: `Matched your skills nearby: ${task.title}`,
              body: `A ${task.categoryLabel || task.category} task has been posted near ${locationLabel} and matches your skills.`,
              data: withHelperAlertData({
                eventKey: 'TASK_NEARBY',
                entityType: 'task',
                skillMatch: true,
                taskId: task._id.toString(),
                category: task.category,
                categoryLabel: task.categoryLabel || task.category,
                budget: task.budget?.amount,
                locationLabel,
                skillMatchCategory: skillMatchCategory || task.categoryLabel || task.category,
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
              }, posterUid),
            },
            nearbyAndSkill,
          );
        }

        if (nearbyOnly.length > 0) {
          await NotificationClient.sendBatch(
            {
              eventKey: 'TASK_NEARBY',
              category: 'recommendedTaskAlerts',
              actorId: posterUid,
              entity: { type: 'task', id: task._id.toString() },
              title: `New task nearby: ${task.title}`,
              body: `A ${task.categoryLabel || task.category} task has been posted near ${locationLabel}.`,
              data: withHelperAlertData({
                eventKey: 'TASK_NEARBY',
                entityType: 'task',
                skillMatch: false,
                taskId: task._id.toString(),
                category: task.category,
                categoryLabel: task.categoryLabel || task.category,
                budget: task.budget?.amount,
                locationLabel,
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
              }, posterUid),
            },
            nearbyOnly,
          );
        }

        // In-app + WhatsApp for skill-matched nearby helpers
        for (const nearbyUid of excludeTaskPoster(nearbyTaskers, posterUid)) {
          try {
            const isNearbyAndSkill = skillMatchedSet.has(nearbyUid);
            if (isNearbyAndSkill) {
              // Governance: one WA per work+helper; skip if already applied.
              const alreadyApplied = await TaskApplication.exists({
                taskId: task._id,
                applicantUid: nearbyUid,
                status: { $in: ['pending', 'accepted'] },
              });
              if (alreadyApplied) continue;

              const categoryLabel =
                skillMatchCategory || task.categoryLabel || task.category || 'work';
              fireWhatsAppNotify({
                uid: nearbyUid,
                templateKey: 'wa_nearby_work_skill_match',
                category: 'recommendedTaskAlerts',
                templateBody: {
                  var_1: task.title || 'New work',
                  var_2: String(categoryLabel),
                  var_3: String(locationLabel),
                },
                templateButtons: taskOpenAppButton(task._id.toString()),
                idempotencyKey: `wa_nearby_work_skill_match:${task._id.toString()}:${nearbyUid}`,
                metadata: {
                  workId: task._id.toString(),
                  triggerType: 'skill_nearby',
                  recipientRole: 'helper',
                },
              });
            }
            await InAppNotificationClient.send({
              userId: nearbyUid,
              title: isNearbyAndSkill ? '🎯 New Skill Matched Nearby' : '📍 New Task Near You',
              body: isNearbyAndSkill
                ? `A ${task.categoryLabel || task.category} task "${task.title}" matches your skills near ${locationLabel}`
                : `"${task.title}" has been posted near ${locationLabel}`,
              category: 'recommendedTaskAlerts',
              type: 'info',
              data: withHelperAlertData({
                eventKey: 'TASK_NEARBY',
                entityType: 'task',
                skillMatch: isNearbyAndSkill,
                taskId: task._id.toString(),
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
                category: task.category,
                categoryLabel: task.categoryLabel || task.category,
                budget: task.budget?.amount,
                locationLabel,
                skillMatchCategory: skillMatchCategory || task.categoryLabel || task.category,
              }, posterUid),
            });
          } catch (inAppError) {
            logger.warn('[TaskService.createTask] NEARBY_ALERTS - In-app failed', {
              taskId: task._id,
              userId: nearbyUid,
              error: inAppError instanceof Error ? inAppError.message : 'Unknown error',
            });
          }
        }

        logger.info('[TaskService.createTask] NEARBY_ALERTS - Notifications sent', {
          taskId: task._id,
          nearbyCount: nearbyTaskers.length,
          nearbyAndSkillCount: nearbyAndSkill.length,
          nearbyOnlyCount: nearbyOnly.length,
          locationLabel,
        });
      } else {
        logger.info('[TaskService.createTask] NEARBY_ALERTS - No nearby taskers found', {
          taskId: task._id,
          hasCoordinates: !!(task.location?.coordinates),
        });
      }
    } catch (error) {
      logger.error('Error sending TASK_NEARBY notification', {
        taskId: task._id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return task.toObject();
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

    // ✅ Compare ObjectIds
    if (!task.requesterId.equals(profileId)) {
      throw new ForbiddenError("Not authorized to edit this task");
    }

    // STEP 1: Get old state for diff check
    const oldStatus = task.status;
    const oldScheduledDate = task.scheduledDate?.getTime();
    const oldAssigneeId = task.assigneeId; // ✅ Updated from assigneeUid

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

    // Non-negotiable tasks: poster may change the listed budget at most once via updateTask (Edit Work).
    if (updateData.budget && task.isNegotiable === false) {
      const newAmt = Number((updateData.budget as any).amount);
      const oldAmt = Number((task.budget as any)?.amount ?? 0);
      if (Number.isFinite(newAmt) && newAmt !== oldAmt) {
        if ((task as any).posterBudgetEditedViaFormOnce === true) {
          throw new BadRequestError(
            "You can only update the fixed budget once. Further budget changes are not allowed here."
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

    logger.info("🔍 Update data after budget normalization:", updateData);

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
    // ✅ Compare ObjectIds (need to convert to string for comparison)
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

      // Firebase UIDs only — ObjectIds are not valid notification recipients.
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

      // Email: task_updated → requester + assignee
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

  /**
   * Delete a task
   */
  static async deleteTask(taskId: string, profileId: mongoose.Types.ObjectId): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // ✅ Compare ObjectIds
    if (!task.requesterId.equals(profileId)) {
      throw new ForbiddenError("Not authorized to delete this task");
    }

    await Task.findByIdAndDelete(taskId);
    TaskService.invalidateTaskCache(taskId);
    logger.info(`Task deleted: ${taskId} by user ${profileId.toString()}`);
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

    // ✅ Compare ObjectIds
    const isCreator = task.requesterId.equals(profileId);
    const isPerformer = task.assigneeId?.equals(profileId) || false; // ✅ Updated from assigneeUid

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

      if (startOtp.expiresAt && new Date(startOtp.expiresAt).getTime() < Date.now()) {
        throw new BadRequestError("Start OTP expired. Please resend and verify OTP again");
      }
    }

    // Once work starts, cancellation is not allowed.
    if (status === "cancelled" && task.status !== "assigned") {
      throw new BadRequestError("Task can only be cancelled before it is started");
    }

    // Performer cannot cancel after payment is held (poster cancel on assigned still refunds).
    if (status === "cancelled" && isPerformer && !isCreator) {
      const escrowForCancel = await PaymentClient.getEscrowByTaskId(taskId);
      if (isActiveEscrow(escrowForCancel)) {
        throw new BadRequestError(
          "Cannot cancel after payment is held. Contact support if you need help."
        );
      }
    }

    let cancellationPaymentResult:
      | { success: boolean; cancelled?: boolean; refundRequired?: boolean; refund?: unknown; error?: string }
      | null = null;

    if (status === "cancelled") {
      const escrow = await PaymentClient.getEscrowByTaskId(taskId);
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
        logger.info('[TaskService.updateTaskStatus] Cancellation payment workflow started', {
          taskId,
          actorProfileId: profileId.toString(),
          actorRole: isRequesterCancelled ? 'poster' : 'performer',
          actorUid: uid,
          hasEscrow: true,
          taskStartDate: taskStart.toISOString(),
          assignedAt: task.assignedAt ? new Date(task.assignedAt).toISOString() : undefined,
          feeBaseAmount:
            taskBudgetAmount !== undefined && Number.isFinite(taskBudgetAmount)
              ? taskBudgetAmount
              : undefined,
        });
        const payResult = await PaymentClient.cancelPaymentForTask({
          taskId,
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
      updateData.cancelledById = profileId; // ✅ Updated from cancelledBy
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

    // Emit real-time status update
    emitTaskStatusChanged(taskId, updatedTask);

    // ── Push + in-app notifications for progress status changes ─────────────
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

    // ── Push + in-app notifications to tasker for poster-triggered status changes ──
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
            status: 'completed',
            eventKey: 'TASK_UPDATED',
            entityType: 'task',
          };

          // Push notification
          await NotificationClient.send({
            eventKey: 'TASK_UPDATED',
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

          logger.info('[TaskService] Completion notification sent to tasker', { taskId, taskerUid });
        } catch (err) {
          logger.warn('[TaskService] Failed to send completion notification to tasker', {
            taskId,
            error: err instanceof Error ? err.message : err,
          });
        }
      });
    }

    // Email: task cancelled → notify the other party
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
            logger.info('[TaskService.updateTaskStatus] Sending task cancelled in-app notification', {
              taskId,
              recipientUid: otherProfile.uid,
              recipientRole: isRequesterCancelled ? 'tasker' : 'poster',
              cancelledBy: isRequesterCancelled ? 'poster' : 'performer',
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
              },
            });

            fireWhatsAppNotify({
              uid: otherProfile.uid,
              templateKey: isRequesterCancelled
                ? 'wa_work_cancelled_helper'
                : 'wa_work_cancelled_customer',
              category: 'taskUpdates',
              templateBody: { var_1: task.title || 'your task' },
              idempotencyKey: `cancel:${taskId.toString()}:${otherProfile.uid}`,
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

    // Email: task started / in_progress → notify requester
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

    // Email: task completed → notify requester + assignee (when poster marks completed directly)
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

      // Payout is now helper-requested from app (not auto-processed here).
      try {
        if (task.assigneeId) {
          await InAppNotificationClient.send({
            userId: task.assigneeId.toString(),
            title: "Request your payout",
            body: `Task completed. Open task tracking and request payout for \"${task.title}\".`,
            type: "info",
            category: "payments",
            data: {
              taskId,
              actionUrl: "/profile?section=payments",
            },
          });
        }
      } catch (paymentError) {
        logger.error(`Error sending payout-request notification from updateTaskStatus for task ${taskId}:`, paymentError);
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
  ): Promise<{ expiresAt: Date; sentTo: string }> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    const isPerformer = task.assigneeId?.equals(profileId) || false;
    if (!isPerformer) {
      throw new ForbiddenError("Only assigned performer can request start OTP");
    }

    if (task.status !== "assigned") {
      throw new BadRequestError("OTP can only be requested when task is in assigned status");
    }

    // Reverted: no additional-quote pending gate in legacy flow.

    const Profile = mongoose.connection.collection("profiles");
    const requesterProfile = await Profile.findOne({ _id: task.requesterId });

    const requesterUid =
      requesterProfile && typeof requesterProfile === "object" && "uid" in requesterProfile
        ? (requesterProfile as { uid?: unknown }).uid
        : undefined;

    if (!requesterUid || typeof requesterUid !== "string") {
      throw new BadRequestError("Requester notification channel unavailable");
    }

    const otp = generateStartOtpCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + START_OTP_TTL_MS);

    const nextResendCount = options?.isResend
      ? (task.startOtp?.resendCount || 0) + 1
      : task.startOtp?.resendCount || 0;

    task.startOtp = {
      codeHash: hashStartOtp(taskId, otp),
      requestedAt: now,
      expiresAt,
      attempts: 0,
      resendCount: nextResendCount,
      requestedById: profileId,
    };

    await task.save();

    const otpBody = `Task start OTP for \"${task.title}\": ${otp}. Valid for 10 minutes.`;
    const pushTitle = options?.isResend ? 'Task Start OTP (resent)' : 'Task Start OTP';
    const notificationData = {
      taskId,
      otp,
      otpType: 'task_start',
      expiresAt: expiresAt.toISOString(),
      eventKey: 'TASK_UPDATED',
      entityType: 'task',
    };

    // Send via both email and in-app notifications for redundancy
    let taskerName = "tasker";
    if (task.assigneeId && typeof task.assigneeId === "object") {
      try {
        const assigneeId = task.assigneeId as mongoose.Types.ObjectId;
        const assigneeProfile = await Profile.findOne({ _id: assigneeId });
        if (assigneeProfile) {
          taskerName = (assigneeProfile as any).name || (assigneeProfile as any).fullName || "tasker";
        }
      } catch (err) {
        logger.warn("Failed to fetch assignee profile for task start OTP", { taskId, error: err });
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
          taskTitle: task.title,
          otp,
          expiresAt: expiresAt.toISOString(),
          userId: requesterUid,
        });
      } else {
        logger.warn("Skipping task start OTP email: requester email missing", { taskId, requesterUid });
      }
    } catch (emailError) {
      logger.warn("Failed to send task start OTP via email", { taskId, error: emailError });
    }

    // Push notification (FCM) to poster — same content as in-app for lock-screen visibility
    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: _uid,
        recipients: [requesterUid],
        entity: { type: 'task', id: taskId },
        title: pushTitle,
        body: otpBody,
        data: notificationData,
      });
    } catch (pushError) {
      logger.warn("Failed to send task start OTP via push notification", { taskId, error: pushError });
    }

    // Send in-app notification for immediate visibility
    try {
      await InAppNotificationClient.send({
        userId: requesterUid,
        title: pushTitle,
        body: otpBody,
        type: "info",
        category: "taskUpdates",
        data: notificationData,
      });
    } catch (inAppError) {
      logger.warn("Failed to send task start OTP via in-app notification", { taskId, error: inAppError });
    }

    TaskService.invalidateTaskCache(taskId);

    return {
      expiresAt,
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

    const isPerformer = task.assigneeId?.equals(profileId) || false;
    if (!isPerformer) {
      throw new ForbiddenError("Only assigned performer can verify start OTP");
    }

    if (task.status !== "assigned") {
      throw new BadRequestError("Task is not in assigned state");
    }

    // Reverted: no additional-quote pending gate in legacy flow.

    const sanitizedOtp = (otp || "").replace(/\D/g, "").slice(0, 6);
    if (sanitizedOtp.length !== 6) {
      throw new BadRequestError("Please enter a valid 6-digit OTP");
    }

    const Profile = mongoose.connection.collection("profiles");
    const posterProfile = await Profile.findOne({ _id: task.requesterId });
    const rawPosterUid =
      posterProfile && typeof posterProfile === "object" && "uid" in posterProfile
        ? (posterProfile as { uid?: unknown }).uid
        : undefined;
    const posterUid = typeof rawPosterUid === "string" ? rawPosterUid : undefined;

    if (acceptsPosterDummyStartOtp(posterUid, sanitizedOtp)) {
      logger.warn("start_otp_poster_dummy_accepted", {
        taskId,
        posterUid: posterUid ?? null,
      });
      return TaskService.updateTaskStatus(taskId, profileId, "started", {
        skipStartOtpValidation: true,
      });
    }

    if (!task.startOtp?.codeHash || !task.startOtp?.expiresAt) {
      throw new BadRequestError("Start OTP not requested. Please request OTP first");
    }

    if (task.startOtp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestError("OTP expired. Please resend OTP");
    }

    if ((task.startOtp.attempts || 0) >= START_OTP_MAX_ATTEMPTS) {
      throw new BadRequestError("Too many invalid attempts. Please resend OTP");
    }

    const expectedHash = hashStartOtp(taskId, sanitizedOtp);
    if (task.startOtp.codeHash !== expectedHash) {
      task.startOtp.attempts = (task.startOtp.attempts || 0) + 1;
      await task.save();

      if (task.startOtp.attempts >= START_OTP_MAX_ATTEMPTS) {
        throw new BadRequestError("OTP mismatch. Max attempts reached. Please resend OTP");
      }

      throw new BadRequestError("OTP mismatch");
    }

    task.startOtp.verifiedAt = new Date();
    await task.save();

    return TaskService.updateTaskStatus(taskId, profileId, "started", {
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

    // Can only request changes when task is in review status
    if (task.status !== 'review') {
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
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedTask) {
      throw new NotFoundError('Task not found');
    }

    logger.info(`Change request submitted for task ${taskId} by requester ${profileId.toString()}`);

    // Send notification to assignee about the change request
    if (task.assigneeId) {
      try {
        const Profile = mongoose.connection.collection("profiles");
        const requesterProfile = await Profile.findOne({ _id: profileId });
        const assigneeProfile = await Profile.findOne({ _id: task.assigneeId });

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

        // Send in-app + push notification to tasker using Firebase UID
        if (assigneeProfile?.uid) {
          const taskerUid = String(assigneeProfile.uid);
          const posterName = requesterProfile?.name || requesterProfile?.fullName || 'The poster';
          const notifData = {
            taskId,
            changeMessage: message,
            status: 'started',
            eventKey: 'TASK_UPDATED',
            entityType: 'task',
          };

          // Push notification (FCM — works when app is closed)
          await NotificationClient.send({
            eventKey: 'TASK_UPDATED',
            category: 'taskUpdates',
            actorId: profileId.toString(),
            recipients: [taskerUid],
            entity: { type: 'task', id: taskId },
            title: 'Revision requested',
            body: `${posterName} has requested changes on "${task.title}". Please review and resubmit.`,
            data: notifData,
          }).catch((err: Error) =>
            logger.error('Error sending push notification for changes_requested', {
              taskId,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          );

          // In-app notification
          await InAppNotificationClient.send({
            userId: taskerUid,
            title: 'Revision requested',
            body: `${posterName} has requested changes on "${task.title}". Please review and resubmit.`,
            type: 'warning',
            category: 'taskUpdates',
            data: notifData,
          }).catch((err: Error) =>
            logger.error('Error sending in-app notification for changes_requested', {
              taskId,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          );
        } else {
          logger.warn('[TaskService.requestChanges] Could not resolve tasker Firebase UID for notification', {
            taskId,
            assigneeId: task.assigneeId?.toString(),
          });
        }
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
}
