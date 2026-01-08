import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ReviewService } from '../services/ReviewService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import mongoose from 'mongoose';
import { onReviewSubmitted } from '../utils/profileStatsHooks';

export class ReviewController {
  /**
   * POST /api/v1/reviews
   * Create a review
   */
  static async createReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const review = await ReviewService.createReview(
      req.body.taskId,
      new mongoose.Types.ObjectId(req.user!.profileId),
      req.user!.uid,
      req.body
    );

    // Trigger profile stats update for the reviewed user
    onReviewSubmitted({ reviewedId: review.reviewedId.toString() }).catch(err => {
      console.error('Failed to update profile stats after review:', err);
    });

    ApiResponse.created(res, review, 'Review submitted successfully');
  }
  
  /**
   * GET /api/v1/reviews/task/:taskId
   * Get review for a specific task
   */
  static async getTaskReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const review = await ReviewService.getTaskReview(
      req.params.taskId,
      new mongoose.Types.ObjectId(req.user!.profileId),
      req.user!.uid
    );

    ApiResponse.success(res, review, 'Review retrieved successfully');
  }

  /**
   * GET /api/v1/reviews/user/:userId
   * Get reviews for a specific user (PUBLIC - no auth required)
   */
  static async getUserReviews(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { limit, skip, rating } = req.query;

    const result = await ReviewService.getUserReviews(req.params.userId, {
      limit: limit ? parseInt(limit as string) : undefined,
      skip: skip ? parseInt(skip as string) : undefined,
      rating: rating ? parseInt(rating as string) : undefined,
    });

    ApiResponse.success(res, result.reviews, 'Reviews retrieved successfully');
  }
}

