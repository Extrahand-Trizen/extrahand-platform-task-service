import { Router } from 'express';
import { PartnerBookNowController } from '../controllers/PartnerBookNowController';
import { authMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/v1/book-now/available-leads - Open Book Now tasks for partner
router.get(
  '/available-leads',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerBookNowController.getAvailableLeads),
);

// POST /api/v1/tasks/:id/partner-accept - Atomically accept a lead
router.post(
  '/tasks/:id/partner-accept',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerBookNowController.acceptLead),
);

// GET /api/v1/book-now/my-leads - Partner's accepted leads
router.get(
  '/my-leads',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerBookNowController.getMyLeads),
);

export default router;
