import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { AnalyticsService } from '../services/AnalyticsService';
import { BadRequestError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';

export class AnalyticsController {
  static async getTaskCategoryPerformance(req: AuthenticatedRequest, res: Response): Promise<void> {
    const range = req.query.range as string | undefined;
    const data = await AnalyticsService.getTaskCategoryPerformance(range);
    ApiResponse.success(res, data, 'Task category performance fetched successfully');
  }

  static async getTaskCancellationAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
    const range = req.query.range as string | undefined;
    const data = await AnalyticsService.getTaskCancellationAnalytics(range);
    ApiResponse.success(res, data, 'Task cancellation analytics fetched successfully');
  }

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

  static async getUserAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { profileId } = req.params;
    const uidRaw = (req.query.uid as string | undefined) || '';
    const range = req.query.range as string | undefined;

    if (!profileId || !mongoose.Types.ObjectId.isValid(profileId)) {
      throw new BadRequestError('Valid profileId is required');
    }

    const uid = uidRaw.trim();
    if (!uid) {
      throw new BadRequestError('uid query parameter is required');
    }

    const data = await AnalyticsService.getUserAnalytics(profileId, uid, range);
    ApiResponse.success(res, data, 'User analytics fetched successfully');
  }
}

