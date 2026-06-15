import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { PartnerJobsController } from '../controllers/PartnerJobsController';

const router = Router();

router.get('/', authMiddleware, asyncHandler(PartnerJobsController.listJobs));
router.get('/:taskId', authMiddleware, asyncHandler(PartnerJobsController.getJob));
router.post('/:taskId/respond', authMiddleware, asyncHandler(PartnerJobsController.respond));
router.patch('/:taskId/milestone', authMiddleware, asyncHandler(PartnerJobsController.milestone));

export default router;
