import { Response } from "express";
import { AuthenticatedRequest } from "../types";
import { ApplicationService } from "../services/ApplicationService";

export class ApplicationController {
  /**
   * POST /api/v1/applications
   * Submit application for a task
   */
  static async submitApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const application = await ApplicationService.submitApplication(
      req.body.taskId,
      req.user!.uid,
      req.body
    );

    // Old format: return application with id at root
    res.json({
      id: String(application._id),
      ...application,
      message: "Application submitted successfully",
    });
  }

  /**
   * GET /api/v1/applications
   * Get applications
   */
  static async getApplications(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
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
      req.user!.uid,
      filters
    );

    // Old format: return applications array with pagination
    res.json({
      applications: result.applications,
      pagination: result.pagination,
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
    const application = await ApplicationService.getApplicationById(
      req.params.id,
      req.user!.uid
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
    const { status, message } = req.body;
    const application = await ApplicationService.updateApplication(
      req.params.id,
      req.user!.uid,
      { status, message }
    );

    // Old format: return application with id at root
    res.json({
      id: String(application._id),
      ...application,
      message: "Application updated successfully",
    });
  }

  /**
   * POST /api/v1/applications/:id/accept
   * Accept an application (legacy endpoint, redirects to PUT)
   */
  static async acceptApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const application = await ApplicationService.acceptApplication(
      req.params.id,
      req.user!.uid
    );

    // Old format: return application with id at root
    res.json({
      id: String(application._id),
      ...application,
      message: "Application updated successfully",
    });
  }

  /**
   * POST /api/v1/applications/:id/reject
   * Reject an application (legacy endpoint, redirects to PUT)
   */
  static async rejectApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const application = await ApplicationService.rejectApplication(
      req.params.id,
      req.user!.uid
    );

    // Old format: return application with id at root
    res.json({
      id: String(application._id),
      ...application,
      message: "Application updated successfully",
    });
  }

  /**
   * POST /api/v1/applications/:id/withdraw-pending
   * Withdraw a pending application
   */
  static async withdrawPendingApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    await ApplicationService.withdrawPendingApplication(
      req.params.id,
      req.user!.uid
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
    const { reason } = req.body;
    await ApplicationService.withdrawAcceptedApplication(
      req.params.id,
      req.user!.uid,
      reason
    );
    res.json({ message: "Accepted application withdrawn successfully" });
  }

  /**
   * DELETE /api/v1/applications/:id
   * Withdraw an application (alias for withdrawPendingApplication)
   */
  static async withdrawApplication(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    await ApplicationService.withdrawPendingApplication(
      req.params.id,
      req.user!.uid
    );
    res.json({ message: "Application withdrawn successfully" });
  }
}
