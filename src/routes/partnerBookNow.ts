import { Router } from 'express';
import { PartnerBookNowController } from '../controllers/PartnerBookNowController';
import { authMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/v1/book-now/available-leads
// Returns unassigned Book Now tasks matching partner's work areas.
// "Overdue" tasks are status === 'open' in DB so they are included automatically.
router.get(
  '/available-leads',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerBookNowController.getAvailableLeads as any),
);

// POST /api/v1/book-now/tasks/:id/partner-accept
// Atomically accepts (claims) a Book Now lead for the authenticated partner.
router.post(
  '/tasks/:id/partner-accept',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerBookNowController.acceptLead as any),
);

// GET /api/v1/book-now/my-leads
// Returns the partner's own accepted / active Book Now tasks.
router.get(
  '/my-leads',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerBookNowController.getMyLeads as any),
);

// PATCH /api/v1/book-now/tasks/:id/status
// Partner updates the status of their active Book Now task.
// Body: { status: 'started' | 'in_progress' | 'review' | 'completed' }
// Cancellation: { status: 'cancelled', cancellationReason } — allowed only while
// the task is still 'assigned' (before starting the journey). Applies the
// performer penalty, unassigns the partner and reopens the lead to the pool.
router.patch(
  '/tasks/:id/status',
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(PartnerBookNowController.updateLeadStatus as any),
);

export default router;
