import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { AnalyticsController } from '../controllers/AnalyticsController';

const router = Router();

router.use(serviceAuthMiddleware);

router.get('/categories/breakdown', asyncHandler(AnalyticsController.getTaskCategoryBreakdown));
router.get('/categories/performance', asyncHandler(AnalyticsController.getTaskCategoryPerformance));
router.get('/tasks/cancellations', asyncHandler(AnalyticsController.getTaskCancellationAnalytics));
router.get('/posters/summary', asyncHandler(AnalyticsController.getPosterSummary));
router.get('/posters/:requesterId', asyncHandler(AnalyticsController.getPosterAnalytics));
router.get('/users/:profileId', asyncHandler(AnalyticsController.getUserAnalytics));
router.get('/dispatch', asyncHandler(AnalyticsController.getDispatchMetrics));

export default router;

