import mongoose from "mongoose";
import Task, { ITask } from "../models/Task";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../errors/AppError";
import logger from "../config/logger";
import { TaskCategory, TaskStatus } from "../types";
import { NotificationClient } from "./NotificationClient";
import { UserServiceClient } from "../clients/UserServiceClient";
import { EmailServiceClient } from "../clients/EmailServiceClient";
import { NotificationPreferenceChecker } from "./NotificationPreferenceChecker";
import { config } from "../config/env";
import { emitTaskStatusChanged } from '../socket/socketHandlers';

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
  'title category categorySlug categoryLabel subcategory budget isNegotiable location status urgency priority requesterId assigneeId assignedAt views isFeatured expiresAt scheduledDate flexibility createdAt updatedAt';

export class TaskService {
  /**
   * Get all tasks with optional filtering
   */
  static async getTasks(filters: {
    status?: TaskStatus;
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
    limit?: number;
    page?: number;
  }): Promise<{ tasks: ITask[]; pagination: any }> {
    const { status, category, city, minBudget, maxBudget, search, suburb, remotely, sortBy, excludeRequesterId, assigneeId, posterUid, limit = 50, page = 1 } = filters;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, page), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;

    // Build filters using $and to safely compose multiple $or filters
    const andClauses: any[] = [];

    if (status) andClauses.push({ status });

    if (excludeRequesterId && mongoose.Types.ObjectId.isValid(excludeRequesterId)) {
      andClauses.push({ requesterId: { $ne: new mongoose.Types.ObjectId(excludeRequesterId) } });
    }

    // Filter by assignee ID (for completed task stats)
    if (assigneeId && mongoose.Types.ObjectId.isValid(assigneeId)) {
      andClauses.push({ assigneeId: new mongoose.Types.ObjectId(assigneeId) });
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
      } else {
        // In-person tasks: require coordinates to exist
        andClauses.push({ 'location.coordinates.0': { $exists: true } });
      }
    }

    // Search across title, description, city and category
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, 'i');
      andClauses.push({ $or: [
        { title: re },
        { description: re },
        { 'location.city': re },
        { category: re },
      ] });
    }

    const query = andClauses.length > 0 ? { $and: andClauses } : {};

    // Sorting
    let sortObj: any = { createdAt: -1 }; // default: recent
    if (sortBy) {
      if (sortBy === 'price-low') sortObj = { 'budget.amount': 1 };
      else if (sortBy === 'price-high') sortObj = { 'budget.amount': -1 };
      else if (sortBy === 'date') sortObj = { createdAt: 1 };
      else sortObj = { createdAt: -1 };
    }

    const tasks = await Task.find(query)
      .select(TASK_LIST_SELECT)
      .sort(sortObj)
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
   * Get nearby tasks using geospatial query
   */
  static async getNearbyTasks(params: {
    lat: number;
    lng: number;
    radiusKm?: number;
    limit?: number;
    status?: TaskStatus;
  }): Promise<{ tasks: ITask[]; pagination: any; location: any }> {
    const { lat, lng, radiusKm = 10, limit = 50, status = "open" } = params;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const radiusMeters = radiusKm * 1000;

    const query: any = {
      "location.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          $maxDistance: radiusMeters,
        },
      },
      status,
    };

    const tasks = await Task.find(query)
      .select(TASK_LIST_SELECT)
      .limit(effectiveLimit)
      .sort({ createdAt: -1 })
      .lean();

    const total = await Task.countDocuments(query);

    return {
      tasks: tasks as unknown as ITask[],
      pagination: {
        page: 1,
        limit: effectiveLimit,
        total,
        pages: Math.ceil(total / effectiveLimit),
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
   * Get a single task by ID
   */
  static async getTaskById(taskId: string): Promise<ITask> {
    const task = await Task.findById(taskId).lean();
    if (!task) {
      throw new NotFoundError("Task not found");
    }
    return task as unknown as ITask;
  }

  /**
   * Create a new task
   */
  static async createTask(
    profileId: mongoose.Types.ObjectId,
    taskData: any,
    uid?: string // Firebase UID for notifications (actorId)
  ): Promise<ITask> {
    // Map frontend category to backend enum
    const frontendCategory = taskData.category || taskData.type;
    const mappedCategory = mapCategoryToEnum(frontendCategory);
    const categorySlug = taskData.categorySlug || frontendCategory;
    const categoryLabel = taskData.categoryLabel;

    logger.info(
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
      location = {
        type: "Point" as const,
        coordinates: taskData.location.coordinates || [
          taskData.location.longitude || 0,
          taskData.location.latitude || 0,
        ],
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

    const task = await Task.create(taskPayload);

    logger.info(`✅ Task created successfully: ${task._id}`);

    // Email: task posted confirmation → requester
    try {
      const Profile = mongoose.connection.collection("profiles");
      
      // ✅ FIX: Convert requesterId to ObjectId for proper MongoDB query
      const requesterId = task.requesterId instanceof mongoose.Types.ObjectId 
        ? task.requesterId 
        : new mongoose.Types.ObjectId(task.requesterId);
      
      const requesterProfile = await Profile.findOne({ _id: requesterId });
      if (requesterProfile?.email) {
        logger.debug(`[TaskService.createTask] Sending task_posted_confirmation email to ${requesterProfile.email}`);
        const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
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
          to: requesterProfile.email
        });
      } else {
        logger.debug(`[TaskService.createTask] No email found for requester profile`, {
          requesterId: task.requesterId
        });
      }
    } catch (error) {
      logger.error('Error fetching requester profile or sending task_posted_confirmation email', {
        taskId: task._id,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    // STEP 1: Emit TASK_CREATED_RECOMMENDED notification
    // Find taskers with matching skill category
    if (uid) {
      try {
        const recommendedTaskers = await UserServiceClient.matchUsers('skill', {
          category: mappedCategory
        });
        if (recommendedTaskers.length > 0) {
          await NotificationClient.sendBatch(
            {
              eventKey: 'TASK_CREATED_RECOMMENDED',
              category: 'recommendedTaskAlerts',
              actorId: uid, // Suppress notification to task creator
              entity: { type: 'task', id: task._id.toString() },
              title: `New task matching your skills: ${task.title}`,
              body: `A ${mappedCategory} task has been posted that matches your skills.`,
              data: {
                taskId: task._id.toString(),
                category: mappedCategory,
                budget: task.budget.amount
              }
            },
            recommendedTaskers
          );
            // Email: task_created_recommended → matched taskers
            try {
              const Profile = mongoose.connection.collection('profiles');
              
              // ✅ FIX: query profiles by uid (string), not _id (ObjectId)
              const recommendedProfiles = await Profile.find({ uid: { $in: recommendedTaskers } }).toArray();
            const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
            const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;
            
            for (const p of recommendedProfiles) {
              if (p.email) {
                try {
                  logger.debug(`[TaskService.createTask] Sending task_created_recommended email to ${p.email}`);
                  // Check if user has enabled recommended task alert emails
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
                    logger.info(`[TaskService.createTask] task_created_recommended email sent successfully`, {
                      taskId: task._id,
                      to: p.email,
                      userId: p.uid
                    });
                  } else {
                    logger.info(`[TaskService.createTask] Email notifications disabled for recommended task alerts`, {
                      userId: p.uid
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
      // Find users who have saved keywords matching this task
      try {
        // Extract keywords from task title and description
        const taskKeywords = [
          ...task.title.toLowerCase().split(/\s+/),
          ...task.description.toLowerCase().split(/\s+/)
        ]
          .filter(word => word.length > 3) // Filter short words
          .slice(0, 10); // Limit to top 10 keywords

        logger.info(`[TaskService.createTask] KEYWORD ALERTS - Extracted keywords`, {
          taskId: task._id,
          keywords: taskKeywords,
          keywordCount: taskKeywords.length,
          taskTitle: task.title.substring(0, 50)
        });

        if (taskKeywords.length > 0) {
          logger.info(`[TaskService.createTask] KEYWORD ALERTS - Querying for matched users`, {
            taskId: task._id,
            keywords: taskKeywords
          });

          const keywordMatchedUsers = await UserServiceClient.matchUsers('keywords', {
            keywords: taskKeywords
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
                actorId: uid, // Suppress notification to task creator
                entity: { type: 'task', id: task._id.toString() },
                title: `Alert: Task matches your saved keywords`,
                body: `A new task has been posted with keywords you're interested in: ${taskKeywords.slice(0, 2).join(', ')}`,
                data: {
                  taskId: task._id.toString(),
                  matchedKeywords: taskKeywords.slice(0, 5)
                }
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
              const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;
              const matchedKeywordStr = taskKeywords.slice(0, 2).join(', ');
              
              for (const p of keywordProfiles) {
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
          const categoryMatchedUsers = await UserServiceClient.matchUsers('categories', {
            categorySlugs
          });

          if (categoryMatchedUsers.length > 0) {
            await NotificationClient.sendBatch(
              {
                eventKey: 'TASK_CREATED_CATEGORY',
                category: 'keywordTaskAlerts', // Using same category preference
                actorId: uid,
                entity: { type: 'task', id: task._id.toString() },
                title: `New ${task.categoryLabel || task.category} task posted!`,
                body: `A new ${task.categoryLabel || task.category} task has been posted: ${task.title.substring(0, 50)}${task.title.length > 50 ? '...' : ''}`,
                data: {
                  taskId: task._id.toString(),
                  category: task.categoryLabel || task.category
                }
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
      logger.warn('Skipping notifications - uid not provided for task creation', {
        taskId: task._id,
        profileId: profileId.toString()
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
      // Recipients: Task requester + assignee (if assigned)
      // Note: recipients need to be UIDs, not ObjectIds - will need to populate Profile
      const recipients: string[] = [updatedTask.requesterId.toString()]; // Temporary - will need UID
      if (updatedTask.assigneeId) {
        recipients.push(updatedTask.assigneeId.toString()); // Temporary - will need UID
      }

      try {
        // Determine what changed for the notification body
        let changeDetails = '';
        if (statusChanged) changeDetails += `Status updated to ${updatedTask.status}. `;
        if (scheduledDateChanged) changeDetails += `Scheduled date has been changed. `;
        if (assigneeChanged) changeDetails += `Assignment has been updated. `;

        await NotificationClient.send(
          {
            eventKey: 'TASK_UPDATED',
            category: 'taskUpdates',
            actorId: profileId.toString(), // Temporary - will need UID lookup
            recipients,
            entity: { type: 'task', id: taskId },
            title: `Task Updated: ${updatedTask.title}`,
            body: changeDetails || 'This task has been updated.',
            data: {
              taskId,
              status: updatedTask.status,
              scheduledDate: updatedTask.scheduledDate?.toISOString()
            }
          }
        );
      } catch (error) {
        logger.error('Error sending TASK_UPDATED notification', {
          taskId,
          error: error instanceof Error ? error.message : 'Unknown error'
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
    logger.info(`Task deleted: ${taskId} by user ${profileId.toString()}`);
  }

  /**
   * Increment task views
   */
  static async incrementViews(taskId: string): Promise<void> {
    await Task.findByIdAndUpdate(taskId, { $inc: { views: 1 } });
  }

  /**
   * Update task status
   */
  static async updateTaskStatus(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
    status: TaskStatus,
    options?: { cancellationReason?: string }
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

    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (status === "completed") {
      updateData.completedAt = new Date();
    }

    if (status === "cancelled") {
      updateData.cancelledAt = new Date();
      updateData.cancelledById = profileId; // ✅ Updated from cancelledBy
      updateData.cancellationReason = options?.cancellationReason;
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

    // Email: task cancelled → notify the other party
    if (status === "cancelled") {
      try {
        const Profile = mongoose.connection.collection("profiles");
        const isRequesterCancelled = task.requesterId.equals(profileId);
        const otherPartyId = isRequesterCancelled ? task.assigneeId : task.requesterId;
        const cancellerProfile = await Profile.findOne({ _id: profileId });
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
            taskUrl: `${config.WEB_APP_URL}/tasks/${taskId}`,
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
    
    return updatedTask as unknown as ITask;
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
    return updatedTask as unknown as ITask;
  }
}
