import { Router } from 'express';
import { ReviewController } from '../controllers/ReviewController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/v1/reviews/service-summary - Get ratings and review counts for a category and its packages (PUBLIC - no auth required)
router.get('/service-summary', asyncHandler(ReviewController.getServiceReviewSummary));

// GET /api/v1/reviews/service-reviews - Get paginated customer reviews for a service / package (PUBLIC - no auth required)
router.get('/service-reviews', asyncHandler(ReviewController.getServiceReviews));

// POST /api/v1/reviews - Create a review (requires auth)
router.post('/', authMiddleware, asyncHandler(ReviewController.createReview));

// GET /api/v1/reviews/task/:taskId - Get review for a task (requires auth)
router.get('/task/:taskId', authMiddleware, asyncHandler(ReviewController.getTaskReview));

// GET /api/v1/reviews/user/:userId - Get reviews for a user (PUBLIC - no auth required)
router.get('/user/:userId', asyncHandler(ReviewController.getUserReviews));

// POST /api/v1/reviews/:id/vote - Vote helpful/not helpful (requires auth)
router.post('/:id/vote', authMiddleware, asyncHandler(ReviewController.voteHelpful));

export default router;
