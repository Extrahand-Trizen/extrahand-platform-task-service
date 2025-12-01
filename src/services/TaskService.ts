import Task, { ITask } from '../models/Task';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { TaskCategory, TaskStatus } from '../types';
import { getUserName } from '../utils/profileHelper';

// Helper function to map frontend category values to backend enum values
function mapCategoryToEnum(frontendCategory: string | undefined): TaskCategory {
  if (!frontendCategory) return 'other';
  
  const categoryMap: Record<string, TaskCategory> = {
    // Exact matches
    'cleaning': 'cleaning',
    'repair': 'repair',
    'delivery': 'delivery',
    'assembly': 'assembly',
    'gardening': 'gardening',
    'petcare': 'petcare',
    'other': 'other',
    
    // Frontend variations to backend enum
    'Cleaning': 'cleaning',
    'Repair': 'repair',
    'Delivery': 'delivery',
    'Assembly': 'assembly',
    'Gardening': 'gardening',
    'Pet Care': 'petcare',
    'Petcare': 'petcare',
    'Other': 'other',
    
    // Common variations
    'Home Services': 'other',
    'Home Cleaning': 'cleaning',
    'House Cleaning': 'cleaning',
    'Plumbing': 'repair',
    'Electrical': 'repair',
    'Carpentry': 'repair',
    'Moving': 'delivery',
    'Transport': 'delivery',
    'Furniture Assembly': 'assembly',
    'IKEA Assembly': 'assembly',
    'Garden Maintenance': 'gardening',
    'Pet Sitting': 'petcare',
    'Dog Walking': 'petcare',
    'General': 'other',
    'Miscellaneous': 'other'
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
    if (normalizedCategory.includes(key.toLowerCase()) || key.toLowerCase().includes(normalizedCategory)) {
      return value;
    }
  }
  
  // Default fallback
  logger.warn(`⚠️ Unknown category: "${frontendCategory}", defaulting to "other"`);
  return 'other';
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
    if (city) query['location.city'] = city;

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
        pages: Math.ceil(total / limit)
      }
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
    const { lat, lng, radiusKm = 10, limit = 50, status = 'open' } = params;
    const radiusMeters = radiusKm * 1000;

    const query: any = {
      'location.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
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
  static async getMyTasks(uid: string, filters: {
    status?: TaskStatus;
    limit?: number;
    page?: number;
  }): Promise<{ tasks: ITask[]; pagination: any }> {
    const { status, limit = 50, page = 1 } = filters;
    const skip = (page - 1) * limit;

    const query: any = { requesterId: uid };
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
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get a single task by ID
   */
  static async getTaskById(taskId: string): Promise<ITask> {
    const task = await Task.findById(taskId).lean();
    if (!task) {
      throw new NotFoundError('Task not found');
    }
    return task as unknown as ITask;
  }

  /**
   * Create a new task
   */
  static async createTask(uid: string, requesterName: string | undefined, taskData: any): Promise<ITask> {
    // Map frontend category to backend enum
    const frontendCategory = taskData.category || taskData.type;
    const mappedCategory = mapCategoryToEnum(frontendCategory);
    
    logger.info(`🔍 Category mapping: "${frontendCategory}" → "${mappedCategory}"`);

    // Get requester name - try multiple sources
    let finalRequesterName = requesterName || taskData.requesterName || taskData.creatorName;
    if (!finalRequesterName) {
      // Fetch from profile
      finalRequesterName = await getUserName(uid) || 'Anonymous';
    }

    // Handle budget - can be object or number
    const budget = taskData.budget?.amount || taskData.budget;

    // Handle location with fallbacks
    const location = {
      type: 'Point' as const,
      coordinates: taskData.location?.coordinates || [
        taskData.location?.longitude || 0,
        taskData.location?.latitude || 0
      ], // Default coordinates
      address: taskData.location?.address || taskData.location || 'Address not specified',
      city: taskData.location?.city || taskData.city || 'City not specified',
      state: taskData.location?.state || taskData.state || 'State not specified',
      country: taskData.location?.country || taskData.country || 'India'
    };

    const task = await Task.create({
      title: taskData.title,
      description: taskData.description,
      category: mappedCategory,
      subcategory: taskData.subcategory,
      budget: budget, // Handle both object and number
      budgetType: taskData.budgetType || 'fixed',
      location: location,
      urgency: taskData.urgency || 'medium',
      priority: taskData.priority || 'normal',
      requesterId: uid,
      requesterName: finalRequesterName,
      estimatedDuration: taskData.estimatedDuration || taskData.duration,
      scheduledDate: taskData.scheduledDate,
      scheduledTime: taskData.scheduledTime,
      flexibility: taskData.flexibility || 'flexible',
      requirements: taskData.requirements || taskData.skillsRequired || [],
      images: taskData.images || [],
      tags: taskData.tags || [],
      isUrgent: taskData.isUrgent || false,
      expiresAt: taskData.expiresAt,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    logger.info(`✅ Task created successfully: ${task._id}`);
    return task.toObject();
  }

  /**
   * Update a task
   */
  static async updateTask(taskId: string, uid: string, updates: any): Promise<ITask> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (task.requesterId !== uid) {
      throw new ForbiddenError('Not authorized to edit this task');
    }

    // Normalize budget field to handle both object and number formats
    let updateData = { ...updates, updatedAt: new Date() };
    if (updateData.budget) {
      if (typeof updateData.budget === 'object' && updateData.budget.amount !== undefined) {
        // Convert budget object to number
        updateData.budget = updateData.budget.amount;
      }
    }

    // Map category if provided
    if (updateData.category) {
      updateData.category = mapCategoryToEnum(updateData.category);
    }

    logger.info('🔍 Update data after budget normalization:', updateData);

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!updatedTask) {
      throw new NotFoundError('Task not found');
    }

    logger.info(`Task updated: ${taskId} by user ${uid}`);
    return updatedTask as unknown as ITask;
  }

  /**
   * Delete a task
   */
  static async deleteTask(taskId: string, uid: string): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (task.requesterId !== uid) {
      throw new ForbiddenError('Not authorized to delete this task');
    }

    await Task.findByIdAndDelete(taskId);
    logger.info(`Task deleted: ${taskId} by user ${uid}`);
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
  static async updateTaskStatus(taskId: string, uid: string, status: TaskStatus): Promise<ITask> {
    const validStatuses = ['open', 'assigned', 'started', 'in_progress', 'review', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestError('Invalid status');
    }

    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the creator or assigned performer
    const isCreator = task.requesterId === uid;
    let isAssignedPerformer = task.assigneeUid === uid;

    // If not directly assigned, check if user has an accepted application
    if (!isAssignedPerformer && (task.status === 'assigned' || task.status === 'started' || task.status === 'in_progress' || task.status === 'review')) {
      try {
        const TaskApplication = (await import('../models/TaskApplication')).default;
        const acceptedApplication = await TaskApplication.findOne({
          taskId: task._id,
          applicantUid: uid,
          status: 'accepted'
        });
        isAssignedPerformer = !!acceptedApplication;
      } catch (error) {
        logger.warn('Could not check applications for performer status:', error);
      }
    }

    if (!isCreator && !isAssignedPerformer) {
      throw new ForbiddenError('Not authorized to update this task');
    }

    // Performers can only update status to certain values
    if (isAssignedPerformer && !isCreator) {
      const allowedPerformerStatuses = ['started', 'in_progress', 'review'];
      if (!allowedPerformerStatuses.includes(status)) {
        throw new ForbiddenError('Performers can only update status to: started, in_progress, or review');
      }
    }

    // Creators can update to any status except 'started' and 'in_progress' (performer-only statuses)
    if (isCreator && !isAssignedPerformer) {
      const restrictedCreatorStatuses = ['started', 'in_progress'];
      if (restrictedCreatorStatuses.includes(status)) {
        throw new ForbiddenError('Only assigned performers can update status to: started or in_progress');
      }
    }

    // Special handling for task completion
    let updateData: any = { status, updatedAt: new Date() };
    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!updatedTask) {
      throw new NotFoundError('Task not found');
    }

    logger.info(`Task status updated: ${taskId} to ${status} by user ${uid}`);
    return updatedTask as unknown as ITask;
  }
}

