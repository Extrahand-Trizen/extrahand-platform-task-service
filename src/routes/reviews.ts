import { Router } from 'express';
import { ReviewController } from '../controllers/ReviewController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/v1/reviews - Create a review (requires auth)
router.post('/', authMiddleware, asyncHandler(ReviewController.createReview));

// GET /api/v1/reviews/task/:taskId - Get review for a task (requires auth)
router.get('/task/:taskId', authMiddleware, asyncHandler(ReviewController.getTaskReview));

// GET /api/v1/reviews/user/:userId - Get reviews for a user (PUBLIC - no auth required)
router.get('/user/:userId', asyncHandler(ReviewController.getUserReviews));

export default router;

