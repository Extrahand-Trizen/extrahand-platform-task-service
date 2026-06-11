import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.use(serviceAuthMiddleware);

router.post('/', authMiddleware, asyncHandler(BookingController.createBooking));
router.get('/mine', authMiddleware, asyncHandler(BookingController.listMyOrders));
router.get(
  '/by-task/:taskId',
  authMiddleware,
  asyncHandler(BookingController.getOrderIdForTask),
);
router.get('/:orderId', authMiddleware, asyncHandler(BookingController.getOrder));
router.post(
  '/:orderId/cancel-item',
  authMiddleware,
  asyncHandler(BookingController.cancelOrderItem),
);
router.post('/:orderId/cancel', authMiddleware, asyncHandler(BookingController.cancelOrder));

export default router;
