import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { BadRequestError } from '../errors/AppError';
import { AnalyticsService } from '../services/AnalyticsService';
import { ReviewService } from '../services/ReviewService';

export class StatsController {
  /**
   * GET /api/v1/stats/users/:profileId?uid=<firebase_uid>
   * Service-to-service endpoint for consolidated user stats.
   */
  static async getUserStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { profileId } = req.params;
    const uid = (req.query.uid as string) || '';

    if (!profileId) {
      throw new BadRequestError('profileId is required');
    }

    if (!uid) {
      throw new BadRequestError('uid query parameter is required');
    }

    const [taskStats, reviewStats] = await Promise.all([
      AnalyticsService.getUserTaskStats(profileId, uid),
      ReviewService.getUserReviewStats(profileId),
    ]);

    const totalReviews = reviewStats.totalReviews || 0;
    const avgRating = Number(reviewStats.avgRating || 0);

    res.json({
      success: true,
      data: {
        totalTasks: taskStats.totalTasks,
        completedTasks: taskStats.completedTasks,
        postedTasks: taskStats.postedTasks,
        totalReviews,
        avgRating,
      },
    });
  }
}

import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { BadRequestError } from '../errors/AppError';
import { AnalyticsService } from '../services/AnalyticsService';
import { ReviewService } from '../services/ReviewService';

export class StatsController {
  /**
   * GET /api/v1/stats/users/:profileId?uid=<firebase_uid>
   * Service-to-service endpoint for consolidated user stats.
   */
  static async getUserStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { profileId } = req.params;
    const uid = (req.query.uid as string) || '';

    if (!profileId) {
      throw new BadRequestError('profileId is required');
    }

    if (!uid) {
      throw new BadRequestError('uid query parameter is required');
    }

    const [taskStats, reviewData] = await Promise.all([
      AnalyticsService.getUserTaskStats(profileId, uid),
      ReviewService.getUserReviews(profileId, { limit: 1000, skip: 0 }),
    ]);

    const reviews = reviewData?.reviews || [];
    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0
      ? reviews.reduce((sum: number, review: any) => sum + Number(review?.rating || 0), 0) / totalReviews
      : 0;

    res.json({
      success: true,
      data: {
        totalTasks: taskStats.totalTasks,
        completedTasks: taskStats.completedTasks,
        postedTasks: taskStats.postedTasks,
        totalReviews,
        avgRating,
      },
    });
  }
}

