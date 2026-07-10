import { Router } from "express";
import { TaskController } from "../controllers/TaskController";
import { BudgetRevisionController } from "../controllers/BudgetRevisionController";
import { RecurringVisitController } from "../controllers/RecurringVisitController";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { serviceAuthMiddleware } from "../middleware/serviceAuth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();

// ✅ PUBLIC routes (service auth required, user auth optional)
// GET /api/v1/tasks - Get all tasks (public route)
router.get("/", serviceAuthMiddleware, optionalAuthMiddleware, asyncHandler(TaskController.getTasks));

// POST /api/v1/tasks - Create a new task (must come before /:id route)
router.post(
  "/",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.createTask)
);

// POST /api/v1/tasks/batch - Get tasks in batch (must come before /:id route)
router.post(
  "/batch",
  serviceAuthMiddleware,
  asyncHandler(TaskController.getTasksBatch)
);

// GET /api/v1/tasks/nearby - Get nearby tasks (requires user location from profile)
router.get(
  "/nearby",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getNearbyTasks)
);

// GET /api/v1/tasks/my-tasks - Get tasks posted by current user
router.get(
  "/my-tasks",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getMyTasks)
);

// Backward-compatible alias:
// Some gateway/app deployments may still call /api/v1/tasks/my.
// Keep this route BEFORE "/:id" to avoid "my" being treated as an ObjectId.
router.get(
  "/my",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getMyTasks)
);

// GET /api/v1/tasks/count/open - Fast open-task count by requesterId
router.get(
  "/count/open",
  serviceAuthMiddleware,
  optionalAuthMiddleware,
  asyncHandler(TaskController.getOpenTaskCount)
);

// GET /api/v1/tasks/:id/tracking-bundle - Combined task tracking payload
router.get(
  "/:id/tracking-bundle",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getTrackingBundle)
);

// GET /api/v1/tasks/:id/my-application - Current user's application for a task
router.get(
  "/:id/my-application",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getMyApplication)
);

// GET /api/v1/tasks/:id - Get a single task (public route)
router.get(
  "/:id",
  serviceAuthMiddleware,
  optionalAuthMiddleware,
  asyncHandler(TaskController.getTask)
);

// PUT /api/v1/tasks/:id - Update a task
router.put(
  "/:id",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.updateTask)
);

// DELETE /api/v1/tasks/:id - Delete a task
router.delete(
  "/:id",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.deleteTask)
);

// PATCH /api/v1/tasks/:id/status - Update task status
router.patch(
  "/:id/status",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.updateTaskStatus)
);

// POST /api/v1/tasks/:id/start-otp/send - Send OTP to requester before task start
router.post(
  "/:id/start-otp/send",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.sendStartOtp)
);

// POST /api/v1/tasks/:id/start-otp/resend - Resend OTP to requester
router.post(
  "/:id/start-otp/resend",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.resendStartOtp)
);

// POST /api/v1/tasks/:id/start-otp/verify - Verify OTP and start task
router.post(
  "/:id/start-otp/verify",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.verifyStartOtp)
);

// GET /api/v1/tasks/:id/start-otp - Poster reads OTP for Work Progress
router.get(
  "/:id/start-otp",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getStartOtp)
);

// POST /api/v1/tasks/:id/execution-phase/arrived - Helper marks arrived
router.post(
  "/:id/execution-phase/arrived",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.markExecutionArrived)
);

// POST /api/v1/tasks/:id/submit-proof - Submit completion proof for review
router.post(
  "/:id/submit-proof",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.submitCompletionProof)
);

// POST /api/v1/tasks/:id/request-changes - Request changes from tasker (poster action)
router.post(
  "/:id/request-changes",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.requestChanges)
);

router.post(
  "/:id/additional-quote-request",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.createAdditionalQuoteRequest)
);

router.get(
  "/:id/additional-quote-requests",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getAdditionalQuoteRequests)
);

router.get(
  "/:id/additional-quote-request/active",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.getActiveAdditionalQuoteRequest)
);

router.post(
  "/:id/additional-quote-request/:requestId/accept",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.acceptAdditionalQuoteRequest)
);

router.post(
  "/:id/additional-quote-request/:requestId/reject",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.rejectAdditionalQuoteRequest)
);

router.post(
  "/:id/additional-quote-request/:requestId/withdraw",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.withdrawAdditionalQuoteRequest)
);

router.get(
  "/:id/recurring/visits",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.listVisits)
);

router.post(
  "/:id/recurring/visits/:visitId/confirm-payment",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.confirmVisitPayment)
);

router.post(
  "/:id/recurring/visits/:visitId/skip",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.skipVisit)
);

router.post(
  "/:id/recurring/visits/:visitId/cancel",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.cancelVisit)
);

router.post(
  "/:id/recurring/plan/end",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.endPlan)
);

router.post(
  "/:id/recurring/plan/resume",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.resumePlan)
);

router.post(
  "/:id/recurring/plan/open-next-payment",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.openNextVisitPayment)
);

router.post(
  "/:id/recurring/visits/:visitId/reschedule",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.rescheduleVisit)
);

router.post(
  "/:id/recurring/visits/:visitId/reschedule/request",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.requestVisitReschedule)
);

router.post(
  "/:id/recurring/visits/:visitId/reschedule/respond",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.respondVisitReschedule)
);

router.post(
  "/:id/recurring/visits/:visitId/cancel/request",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.requestVisitCancel)
);

router.post(
  "/:id/recurring/visits/:visitId/cancel/respond",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.respondVisitCancel)
);

router.post(
  "/:id/recurring/plan/pause",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.pausePlan)
);

router.post(
  "/:id/recurring/plan/leave",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(RecurringVisitController.leavePlan)
);

// ── Global Budget Revision ───────────────────────────────────────────────────
// POST /api/v1/tasks/:taskId/revise-budget — Poster revises task budget (max 1 round)
router.post(
  "/:taskId/revise-budget",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(BudgetRevisionController.reviseBudget)
);

export default router;
