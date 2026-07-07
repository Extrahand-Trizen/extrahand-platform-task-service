import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ReviewService } from '../services/ReviewService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import mongoose from 'mongoose';

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
   * POST /api/v1/reviews/:id/vote
   * Vote helpful or not helpful on a review (one vote per user)
   */
  static async voteHelpful(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { id: reviewId } = req.params;
    const { helpful } = req.body;

    if (typeof helpful !== 'boolean') {
      throw new BadRequestError('helpful must be a boolean');
    }

    const updated = await ReviewService.voteHelpful(
      reviewId,
      req.user!.profileId.toString(),
      helpful
    );

    ApiResponse.success(res, updated, 'Vote recorded');
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

