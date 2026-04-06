import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ApplicationService } from '../services/ApplicationService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import logger from '../config/logger';
import Task from '../models/Task';

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
   * Get applications (supports optional auth for public viewing of task applications)
   */
  static async getApplications(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { taskId, status, mine, limit, page } = req.query;

    // Require authentication for "mine" queries
    if (mine === "true" && !req.user?.profileId) {
      throw new BadRequestError('Authentication required to view your applications');
    }

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

    // Pass profileId only if user is authenticated
    const profileId = req.user?.profileId || undefined;

    const result = await ApplicationService.getApplications(
      profileId,
      filters
    );

    // ✅ Filter budget information for non-owners when viewing task applications
    let applications = result.applications;
    if (taskId && !mine) {
      try {
        const task = await Task.findById(taskId);
        const isOwner = task && profileId && task.requesterId.equals(profileId);
        
        // If not the owner, hide budget information for OTHER applicants only.
        // The applicant should always see their own proposed budget.
        if (!isOwner && task) {
          applications = applications.map((app: any) => {
            const isOwnApplication = profileId && String(app.applicantId) === String(profileId);
            if (isOwnApplication) return app; // applicant can see their own budget
            return {
              ...app,
              proposedBudget: undefined, // Hide other applicants' budgets from non-owners
            };
          });
        }
      } catch (error) {
        // If task lookup fails, continue without filtering (safety measure)
        logger.warn('Could not filter budget information:', error);
      }
    }

    ApiResponse.paginated(res, applications, 'Applications retrieved successfully', result.pagination);
    
    // Log for debugging
    logger.info(`[ApplicationController.getApplications] Response sent`, {
      applicationsCount: applications.length,
      hasProfiles: applications.filter((a: any) => !!a.applicantProfile?.name).length,
      taskId: taskId || 'all',
      isOwner: !!profileId && taskId ? 'pending' : 'n/a'
    });
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

  static async editApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { coverLetter, proposedBudget } = req.body;
    if (coverLetter === undefined && proposedBudget === undefined) {
      throw new BadRequestError(
        'Provide at least one editable field: coverLetter or proposedBudget.'
      );
    }

    const application = await ApplicationService.editApplication(
      req.params.id,
      req.user!.profileId,
      {
        coverLetter,
        proposedBudget,
      }
    );

    ApiResponse.success(res, application, 'Application edited successfully');
  }

  static async negotiateApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { action, amount } = req.body || {};
    const application = await ApplicationService.negotiateApplication(
      req.params.id,
      req.user!.profileId,
      req.user!.uid,
      { action, amount }
    );

    ApiResponse.success(res, application, 'Application negotiation updated successfully');
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
