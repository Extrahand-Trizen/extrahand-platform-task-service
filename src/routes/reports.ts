import { Router } from 'express';
import { ReportController } from '../controllers/ReportController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All report routes require authentication
router.use(authMiddleware);

// POST /api/v1/tasks/:taskId/report - Report a task
router.post('/tasks/:taskId/report', asyncHandler(ReportController.reportTask));

// GET /api/v1/tasks/:taskId/reports - Get reports for a task
router.get('/tasks/:taskId/reports', asyncHandler(ReportController.getTaskReports));

export default router;



