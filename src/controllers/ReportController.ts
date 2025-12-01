import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ReportService } from '../services/ReportService';

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

    // Old format: return with success, message, and data
    res.status(201).json({
      success: true,
      message: 'Task reported successfully. Our team will review it.',
      data: report
    });
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

    // Old format: return with success and data
    res.json({
      success: true,
      data: reports
    });
  }
}



