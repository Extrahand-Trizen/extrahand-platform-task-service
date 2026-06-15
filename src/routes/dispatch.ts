import { Router } from 'express';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';
import { DispatchController } from '../controllers/DispatchController';

const router = Router();

router.post(
  '/book-now/:orderId',
  serviceAuthMiddleware,
  asyncHandler(DispatchController.startBroadcast),
);
router.post(
  '/retry/:taskId',
  serviceAuthMiddleware,
  asyncHandler(DispatchController.retryTask),
);
router.post(
  '/expire-offers',
  serviceAuthMiddleware,
  asyncHandler(DispatchController.expireOffers),
);

export default router;
