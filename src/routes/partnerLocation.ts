import { Router } from 'express';
import { PartnerLocationController } from '../controllers/PartnerLocationController';
import { authMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

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
