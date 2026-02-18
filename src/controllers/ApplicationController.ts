import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ApplicationService } from '../services/ApplicationService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import logger from '../config/logger';

export class ApplicationController {
  /**
   * POST /api/v1/applications
   * Submit application for a task
   */
  static async submitApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    logger.debug(`[ApplicationController.submitApplication] Starting application submission`, {
      taskId: req.body.taskId,
      userId: req.user?.uid,
      profileId: req.user?.profileId
    });

    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    try {
      const application = await ApplicationService.submitApplication(
        req.body.taskId,
         req.user!.profileId,
         req.user!.uid,
        req.body
      );

      logger.info(`[ApplicationController.submitApplication] Application submitted successfully`, {
        applicationId: application._id,
        taskId: req.body.taskId
      });

      ApiResponse.created(res, application, 'Application submitted successfully');
    } catch (error) {
      logger.error(`[ApplicationController.submitApplication] Error occurred`, {
        taskId: req.body.taskId,
        userId: req.user?.uid,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * GET /api/v1/applications
   * Get applications
   */
  static async getApplications(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { taskId, status, mine, limit, page } = req.query;

    const filters: any = {
      limit: limit ? parseInt(limit as string) : undefined,
      page: page ? parseInt(page as string) : undefined,
      status: status as any,
    };

    if (taskId) {
      filters.taskId = taskId as string;
    }

    if (mine === "true") {
      filters.mine = true;
    }

    const result = await ApplicationService.getApplications(
      req.user!.profileId,
      filters
    );

    ApiResponse.paginated(res, result.applications, 'Applications retrieved successfully', result.pagination,);
  }

  /**
   * GET /api/v1/applications/:id
   * Get application by ID
   */
  static async getApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const application = await ApplicationService.getApplicationById(
      req.params.id,
      req.user!.profileId
    );
    res.json(application);
  }

  /**
   * PUT /api/v1/applications/:id
   * Update application status (accept/reject)
   */
  static async updateApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { status, message } = req.body;
    const application = await ApplicationService.updateApplication(
      req.params.id,
      req.user!.profileId,
      req.user!.uid,
      { status, message }
    );

    ApiResponse.success(res, application, 'Application updated successfully');
  }

  /**
   * POST /api/v1/applications/:id/accept
   * Accept an application (legacy endpoint, redirects to PUT)
   */
  static async acceptApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const application = await ApplicationService.acceptApplication(
      req.params.id,
      req.user!.profileId,
      req.user!.uid
    );

    ApiResponse.success(res, application, 'Application accepted successfully');
  }

  /**
   * POST /api/v1/applications/:id/reject
   * Reject an application (legacy endpoint, redirects to PUT)
   */
  static async rejectApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const application = await ApplicationService.rejectApplication(
      req.params.id,
      req.user!.profileId,
      req.user!.uid
    );

    ApiResponse.success(res, application, "Application rejected successfully",);
  }

  /**
   * POST /api/v1/applications/:id/withdraw-pending
   * Withdraw a pending application
   */
  static async withdrawPendingApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    await ApplicationService.withdrawPendingApplication(
      req.params.id,
      req.user!.profileId
    );
    res.json({ message: "Pending application withdrawn successfully" });
  }

  /**
   * POST /api/v1/applications/:id/withdraw-accepted
   * Withdraw an accepted application
   */
  static async withdrawAcceptedApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }


    await ApplicationService.withdrawAcceptedApplication(
      req.params.id,
      req.user!.profileId
    );
    res.json({ message: "Accepted application withdrawn successfully" });
  }

  /**
   * DELETE /api/v1/applications/:id
   * Withdraw an application (alias for withdrawPendingApplication)
   */
  static async withdrawApplication(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    await ApplicationService.withdrawApplication(req.params.id, req.user!.profileId);

    ApiResponse.success(res, null, 'Application withdrawn successfully');
  }
}
