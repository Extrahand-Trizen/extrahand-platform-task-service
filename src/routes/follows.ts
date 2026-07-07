import { Router } from 'express';
import { FollowController } from '../controllers/FollowController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All follow routes require authentication
router.use(authMiddleware);

// POST /api/v1/tasks/:taskId/follow - Follow a task
router.post('/tasks/:taskId/follow', asyncHandler(FollowController.followTask));

// DELETE /api/v1/tasks/:taskId/follow - Unfollow a task
router.delete('/tasks/:taskId/follow', asyncHandler(FollowController.unfollowTask));

// GET /api/v1/tasks/:taskId/follow - Check if user is following a task
router.get('/tasks/:taskId/follow', asyncHandler(FollowController.checkFollowStatus));

// GET /api/v1/tasks/followed - Get all tasks followed by user
router.get('/tasks/followed', asyncHandler(FollowController.getFollowedTasks));

export default router;



