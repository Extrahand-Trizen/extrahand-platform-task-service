import { Router } from 'express';
import { CompletionController } from '../controllers/CompletionController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All completion routes require authentication
router.use(authMiddleware);

// POST /api/v1/tasks/:taskId/complete - Submit completion proof
router.post('/tasks/:taskId/complete', asyncHandler(CompletionController.submitCompletion));

// POST /api/v1/tasks/:taskId/approve-completion - Approve completion
router.post('/tasks/:taskId/approve-completion', asyncHandler(CompletionController.approveCompletion));

// POST /api/v1/tasks/:taskId/reject-completion - Reject completion
router.post('/tasks/:taskId/reject-completion', asyncHandler(CompletionController.rejectCompletion));

export default router;

