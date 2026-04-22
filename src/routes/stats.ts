import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { StatsController } from '../controllers/StatsController';

const router = Router();

router.use(serviceAuthMiddleware);

router.get('/users/:profileId', asyncHandler(StatsController.getUserStats));

export default router;

