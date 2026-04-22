import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { AnalyticsController } from '../controllers/AnalyticsController';

const router = Router();

router.use(serviceAuthMiddleware);

router.get('/categories/breakdown', asyncHandler(AnalyticsController.getTaskCategoryBreakdown));
router.get('/posters/summary', asyncHandler(AnalyticsController.getPosterSummary));
router.get('/posters/:requesterId', asyncHandler(AnalyticsController.getPosterAnalytics));

export default router;

