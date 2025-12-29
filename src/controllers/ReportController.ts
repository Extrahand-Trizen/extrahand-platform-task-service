import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ReportService } from '../services/ReportService';
import { ApiResponse } from '../utils/ApiResponse';

export class ReportController {
  /**
   * POST /api/v1/tasks/:taskId/report
   * Report a task
   */
  static async reportTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { reason, description } = req.body;
    const report = await ReportService.reportTask(
      req.params.taskId,
      req.user!.uid,
      reason,
      description
    );

    ApiResponse.created(res, report, 'Task reported successfully. Our team will review it.');
  }

  /**
   * GET /api/v1/tasks/:taskId/reports
   * Get reports for a task
   */
  static async getTaskReports(req: AuthenticatedRequest, res: Response): Promise<void> {
    const reports = await ReportService.getTaskReports(
      req.params.taskId,
      req.user!.uid
    );

    ApiResponse.success(res, reports, 'Reports retrieved successfully');
  }
}



