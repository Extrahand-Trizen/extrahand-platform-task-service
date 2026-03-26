import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { TaskService } from '../services/TaskService';
import { ApplicationService } from '../services/ApplicationService';
import { BadRequestError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { containsPhoneNumber, PHONE_NUMBER_ERROR } from '../utils/phoneDetection';

export class TaskController {
  /**
   * GET /api/v1/tasks
   * Get all tasks with optional filtering
   */
  static async getTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { status, category, city, limit, page, minBudget, maxBudget, search, suburb, remotely, sortBy, excludeRequesterId, assigneeId, posterUid } = req.query;

    // Allow comma-separated statuses (frontend may send multiple, e.g. "open,assigned")
    const statusParam = status ? (status as string) : undefined;
    const statuses = statusParam && statusParam.includes(',') ? statusParam.split(',').map(s => s.trim()).filter(Boolean) : statusParam;

    // Allow comma-separated categories (frontend may send multiple)
    const categoriesParam = category ? (category as string) : undefined;
    const categories = categoriesParam && categoriesParam.includes(',') ? categoriesParam.split(',').map(s => s.trim()).filter(Boolean) : categoriesParam;

    // Parse remotely (could be 'true'/'false' string)
    let remotelyBool: boolean | null = null;
    if (typeof remotely !== 'undefined') {
      remotelyBool = remotely === 'true' ? true : remotely === 'false' ? false : null;
    }

    const result = await TaskService.getTasks({
      status: statuses as any,
      category: categories as any,
      city: city as string,
      minBudget: minBudget ? parseFloat(minBudget as string) : undefined,
      maxBudget: maxBudget ? parseFloat(maxBudget as string) : undefined,
      search: search ? (search as string) : undefined,
      suburb: suburb ? (suburb as string) : undefined,
      remotely: remotelyBool,
      sortBy: sortBy ? (sortBy as string) : undefined,
      excludeRequesterId: excludeRequesterId ? (excludeRequesterId as string) : undefined,
      assigneeId: assigneeId ? (assigneeId as string) : undefined,
      posterUid: posterUid ? (posterUid as string) : undefined,
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

    const parsedLat = parseFloat(lat as string);
    const parsedLng = parseFloat(lng as string);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      throw new BadRequestError('Invalid latitude/longitude');
    }

    const result = await TaskService.getNearbyTasks({
      lat: parsedLat,
      lng: parsedLng,
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

    // Increment views in background so response is not blocked
    setImmediate(() => {
      TaskService.incrementViews(req.params.id).catch(() => { });
    });

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

    const { title, description } = req.body;
    if (containsPhoneNumber(title) || containsPhoneNumber(description)) {
      throw new BadRequestError(PHONE_NUMBER_ERROR);
    }

    // Pass both profileId (ObjectId) and uid (Firebase UID string)
    // profileId is used for database references, uid is used for notifications (actorId)
    const task = await TaskService.createTask(
      req.user!.profileId,
      req.body,
      req.user!.uid // Firebase UID for notification actorId
    );

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

    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const result = await ApplicationService.getApplications(req.user!.profileId, {
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

  /**
   * POST /api/v1/tasks/:id/start-otp/send
   * Generate and send task start OTP to requester
   */
  static async sendStartOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const result = await TaskService.requestStartOtp(
      req.params.id,
      req.user!.profileId,
      req.user!.uid,
      { isResend: false }
    );

    ApiResponse.success(res, result, 'Task start OTP sent to requester');
  }

  /**
   * POST /api/v1/tasks/:id/start-otp/resend
   * Resend a fresh task start OTP to requester
   */
  static async resendStartOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const result = await TaskService.requestStartOtp(
      req.params.id,
      req.user!.profileId,
      req.user!.uid,
      { isResend: true }
    );

    ApiResponse.success(res, result, 'Task start OTP resent to requester');
  }

  /**
   * POST /api/v1/tasks/:id/start-otp/verify
   * Verify OTP and mark task as started
   */
  static async verifyStartOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { otp } = req.body;
    if (!otp) {
      throw new BadRequestError('OTP is required');
    }

    const task = await TaskService.verifyStartOtp(
      req.params.id,
      req.user!.profileId,
      String(otp)
    );

    ApiResponse.success(res, task, 'OTP verified. Task started successfully');
  }

  /**
   * POST /api/v1/tasks/:id/submit-proof
   * Submit completion proof for review
   */
  static async submitCompletionProof(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { proofUrls, notes } = req.body;

    // Import CompletionService for proper proof submission
    const { CompletionService } = await import('../services/CompletionService');

    const task = await CompletionService.submitCompletionProof(
      req.params.id,
      req.user!.profileId.toString(),
      { proofUrls, notes }
    );

    ApiResponse.success(res, task, 'Completion proof submitted for review');
  }

  /**
   * POST /api/v1/tasks/:id/request-changes
   * Request changes from tasker (poster action in review status)
   */
  static async requestChanges(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { message } = req.body;

    const task = await TaskService.requestChanges(
      req.params.id,
      req.user!.profileId,
      message
    );

    ApiResponse.success(res, task, 'Changes requested successfully');
  }
}

