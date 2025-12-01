import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ReviewService } from '../services/ReviewService';

export class ReviewController {
  /**
   * POST /api/v1/reviews
   * Create a review
   */
  static async createReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    const review = await ReviewService.createReview(
      req.body.taskId,
      req.user!.uid,
      req.body
    );

    // Old format: return review with id at root
    res.json({
      id: String(review._id),
      ...review,
      message: 'Review submitted successfully'
    });
  }
  
  /**
   * GET /api/v1/reviews/task/:taskId
   * Get review for a specific task
   */
  static async getTaskReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    const review = await ReviewService.getTaskReview(
      req.params.taskId,
      req.user!.uid
    );

    // Old format: return { review: null } or { review: {...} }
    res.json({ review });
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

    // Old format: return { reviews: [...] }
    res.json({ reviews: result.reviews });
  }
}

