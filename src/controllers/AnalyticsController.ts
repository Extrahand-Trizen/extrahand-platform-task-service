import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { AnalyticsService } from '../services/AnalyticsService';
import { BadRequestError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';

export class AnalyticsController {
  static async getTaskCategoryBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
    const range = req.query.range as string | undefined;
    const data = await AnalyticsService.getTaskCategoryBreakdown(range);
    ApiResponse.success(res, data, 'Task category breakdown fetched successfully');
  }

  static async getPosterAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { requesterId } = req.params;
    const range = req.query.range as string | undefined;

    if (!requesterId || !mongoose.Types.ObjectId.isValid(requesterId)) {
      throw new BadRequestError('Valid requesterId is required');
    }

    const data = await AnalyticsService.getPosterAnalytics(requesterId, range);
    ApiResponse.success(res, data, 'Poster analytics fetched successfully');
  }

  static async getPosterSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
    const range = req.query.range as string | undefined;
    const data = await AnalyticsService.getPosterSummary(range);
    ApiResponse.success(res, data, 'Poster summary fetched successfully');
  }
}

