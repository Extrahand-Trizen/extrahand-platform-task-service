import { Router } from 'express';
import { PartnerLocationController } from '../controllers/PartnerLocationController';
import { authMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/v1/tasks/:id/helper-location
// Helper pushes a live location point (REST fallback channel). Same pipeline as
// the Socket.IO partner:location-update event (Redis + task-room fan-out).
router.post(
  '/tasks/:id/helper-location',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerLocationController.postHelperLocation as any),
);

// GET /api/v1/tasks/:id/partner-location
// Returns the last Redis-cached location of the partner assigned to the given task.
// Requires both gateway forwarding (serviceAuth) and authenticated user (authMiddleware).
router.get(
  '/tasks/:id/partner-location',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerLocationController.getPartnerLocation as any),
);

export default router;
