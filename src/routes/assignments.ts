import { Router } from 'express';
import { AssignmentController } from '../controllers/AssignmentController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.use(serviceAuthMiddleware, authMiddleware);

router.get('/pending', asyncHandler(AssignmentController.listPending));
router.post('/assign', asyncHandler(AssignmentController.assignHelper));

export default router;
