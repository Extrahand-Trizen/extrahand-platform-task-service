import { Router } from 'express';
import { MatchController } from '../controllers/MatchController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All match routes require authentication
router.use(authMiddleware);

// GET /api/v1/matches/tasks/:taskId/candidates - Get candidate matches for a task
router.get('/tasks/:taskId/candidates', asyncHandler(MatchController.getTaskCandidates));

export default router;



