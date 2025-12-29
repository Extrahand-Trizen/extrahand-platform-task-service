import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { TaskService } from '../services/TaskService';
import { ApplicationService } from '../services/ApplicationService';
import { BadRequestError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';

export class TaskController {
  /**
   * GET /api/v1/tasks
   * Get all tasks with optional filtering
   */
  static async getTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { status, category, city, limit, page } = req.query;

    const result = await TaskService.getTasks({
      status: status as any,
      category: category as any,
      city: city as string,
      limit: limit ? parseInt(limit as string) : undefined,
      page: page ? parseInt(page as string) : undefined,
    });

    ApiResponse.paginated(res, result.tasks, 'Tasks retrieved successfully', result.pagination);
  }

  /**
   * GET /api/v1/tasks/nearby
   * Get nearby tasks using geospatial query
   */
  static async getNearbyTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { lat, lng, radiusKm, limit, status } = req.query;

    if (!lat || !lng) {
      throw new BadRequestError('Latitude and longitude required');
    }

    const result = await TaskService.getNearbyTasks({
      lat: parseFloat(lat as string),
      lng: parseFloat(lng as string),
      radiusKm: radiusKm ? parseFloat(radiusKm as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      status: status as any,
    });

    ApiResponse.success(res, result, 'Nearby tasks retrieved successfully');
  }

  /**
   * GET /api/v1/tasks/my-tasks
   * Get tasks posted by the current user
   */
  static async getMyTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { status, limit, page } = req.query;

    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const result = await TaskService.getMyTasks(req.user!.profileId, {
      status: status as any,
      limit: limit ? parseInt(limit as string) : undefined,
      page: page ? parseInt(page as string) : undefined,
    });

    ApiResponse.paginated(res, result.tasks, 'Your tasks retrieved successfully', result.pagination);
  }

  /**
   * GET /api/v1/tasks/:id
   * Get a single task by ID
   */
  static async getTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    const task = await TaskService.getTaskById(req.params.id);

    // Increment views
    await TaskService.incrementViews(req.params.id);

    ApiResponse.success(res, task, 'Task retrieved successfully');
  }

  /**
   * POST /api/v1/tasks
   * Create a new task
   */
  static async createTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const task = await TaskService.createTask(req.user!.profileId, req.body);

    ApiResponse.created(res, task, 'Task created successfully');
  }

  /**
   * PUT /api/v1/tasks/:id
   * Update a task
   */
  static async updateTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const task = await TaskService.updateTask(req.params.id, req.user!.profileId, req.body);

    ApiResponse.success(res, task, 'Task updated successfully');
  }

  /**
   * DELETE /api/v1/tasks/:id
   * Delete a task
   */
  static async deleteTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    await TaskService.deleteTask(req.params.id, req.user!.profileId);

    ApiResponse.success(res, null, 'Task deleted successfully');
  }

  /**
   * GET /api/v1/tasks/:id/applications
   * Get applications for a specific task
   */
  static async getTaskApplications(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id: taskId } = req.params;
    const { limit, page } = req.query;

    if (!taskId) {
      throw new BadRequestError('Task ID is required');
    }

    const result = await ApplicationService.getApplications(req.user!.uid, {
      taskId,
      limit: limit ? parseInt(limit as string) : undefined,
      page: page ? parseInt(page as string) : undefined,
    });

    ApiResponse.paginated(res, result.applications, 'Applications retrieved successfully', result.pagination);
  }

  /**
   * PATCH /api/v1/tasks/:id/status
   * Update task status
   */
  static async updateTaskStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { status, cancellationReason } = req.body;
    
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const task = await TaskService.updateTaskStatus(
      req.params.id,
      req.user!.profileId,
      status,
      { cancellationReason }
    );

    ApiResponse.success(res, task, 'Task status updated successfully');
  }
}

