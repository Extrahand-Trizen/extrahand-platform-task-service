import { Router } from 'express';
import taskRoutes from './tasks';
import applicationRoutes from './applications';
import reviewRoutes from './reviews';
import completionRoutes from './completion';
import questionRoutes from './questions';
import followRoutes from './follows';
import reportRoutes from './reports';
import matchRoutes from './matches';
import uploadRoutes from './uploads';
import testReminderRoutes from './test-reminders';
import analyticsRoutes from './analytics';
import statsRoutes from './stats';
import catalogRoutes from './catalog';
import bookingsRoutes from './bookings';
import assignmentsRoutes from './assignments';
import partnerBookNowRoutes from './partnerBookNow';
import { asyncHandler } from '../middleware/errorHandler';
import { CascadeDeleteController } from '../controllers/CascadeDeleteController';
import { BookingController } from '../controllers/BookingController';
import { RecurringVisitController } from '../controllers/RecurringVisitController';
import { CatalogController } from '../controllers/CatalogController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { gatewayAuthMiddleware } from '../middleware/gatewayAuth';

const router = Router();

// Health check endpoint (no auth required)
router.get('/health', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    service: 'extrahand-task-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}));

// Book Now: payment-service callback (service auth only)
router.post(
  '/bookings/internal/payment-captured',
  serviceAuthMiddleware,
  asyncHandler(BookingController.paymentCaptured)
);

router.post(
  '/recurring/internal/visit-payment-captured',
  serviceAuthMiddleware,
  asyncHandler(RecurringVisitController.visitPaymentCaptured)
);

// Book Now area check — service auth only (customer uid via ?firebaseUid= from gateway)
router.get(
  '/catalog/areas/check',
  serviceAuthMiddleware,
  asyncHandler(CatalogController.checkPinCode),
);

// Consolidated profile stats — service-to-service only (user-service calls this).
// Must be registered BEFORE gatewayAuthMiddleware so it is not rejected as a gateway request.
router.use('/stats', statsRoutes);

// Gateway auth middleware (requires gateway auth)
router.use(gatewayAuthMiddleware);

// Service-to-service cascade delete endpoint (requires service auth)
router.delete(
  '/cascade-delete/user/:uid/open-tasks',
  serviceAuthMiddleware,
  asyncHandler(CascadeDeleteController.deleteOpenPostedTasks.bind(CascadeDeleteController))
);

router.delete(
  '/cascade-delete/user/:uid',
  serviceAuthMiddleware,
  asyncHandler(CascadeDeleteController.deleteUserData.bind(CascadeDeleteController))
);

// Account deletion preview and selective cascade (service-to-service)
router.get(
  '/cascade-delete/user/:uid/account-deletion-preview',
  serviceAuthMiddleware,
  asyncHandler(CascadeDeleteController.getAccountDeletionPreview.bind(CascadeDeleteController))
);

router.delete(
  '/cascade-delete/user/:uid/account-deletion',
  serviceAuthMiddleware,
  asyncHandler(CascadeDeleteController.deleteAccountEligibleData.bind(CascadeDeleteController))
);

// Active tasks that block account deletion (service-to-service)
router.get(
  '/cascade-delete/user/:uid/active-blockers',
  serviceAuthMiddleware,
  asyncHandler(CascadeDeleteController.getActiveDeletionBlockers.bind(CascadeDeleteController))
);

// Diagnostic endpoint: Get all tasks for user (debug why deletion is blocked)
router.get(
  '/cascade-delete/user/:uid/tasks-diagnostic',
  serviceAuthMiddleware,
  asyncHandler(CascadeDeleteController.getUserTasksDiagnostic.bind(CascadeDeleteController))
);

// API routes
router.use('/tasks', taskRoutes);
router.use('/applications', applicationRoutes);
router.use('/reviews', reviewRoutes);
router.use('/', completionRoutes); // Completion routes are already prefixed with /tasks
router.use('/', questionRoutes); // Question routes are already prefixed with /tasks
router.use('/', followRoutes); // Follow routes are already prefixed with /tasks
router.use('/', reportRoutes); // Report routes are already prefixed with /tasks
router.use('/matches', matchRoutes);
router.use('/uploads', uploadRoutes);
router.use('/test/reminders', testReminderRoutes); // Test endpoints (dev only)
router.use('/analytics', analyticsRoutes);
router.use('/catalog', catalogRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/admin/assignments', assignmentsRoutes);
router.use('/book-now', partnerBookNowRoutes);

export default router;

