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

export class TaskService {
  /**
   * Get all tasks with optional filtering
   */
  static async getTasks(filters: {
    status?: TaskStatus;
    category?: TaskCategory;
    city?: string;
    limit?: number;
    page?: number;
  }): Promise<{ tasks: ITask[]; pagination: any }> {
    const { status, category, city, limit = 50, page = 1 } = filters;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (status) query.status = status;
    if (category) query.category = category;
    if (city) query["location.city"] = city;

    const tasks = await Task.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Task.countDocuments(query);

    return {
      tasks: tasks as unknown as ITask[],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
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
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const total = await Task.countDocuments(query);

    return {
      tasks: tasks as unknown as ITask[],
      pagination: {
        page: 1,
        limit,
        total,
        pages: Math.ceil(total / limit),
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
    const skip = (page - 1) * limit;

    const query: any = { requesterId: profileId }; // ✅ ObjectId reference
    if (status) query.status = status;

    const tasks = await Task.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Task.countDocuments(query);

    return {
      tasks: tasks as unknown as ITask[],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
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

    // Only include location if it was provided
    if (location) {
      taskPayload.location = location;
    }

    const task = await Task.create(taskPayload);

    logger.info(`✅ Task created successfully: ${task._id}`);

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

        if (taskKeywords.length > 0) {
          const keywordMatchedUsers = await UserServiceClient.matchUsers('keywords', {
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
          }
        }
      } catch (error) {
        logger.error('Error sending TASK_CREATED_KEYWORD notification', {
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
