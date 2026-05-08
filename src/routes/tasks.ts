import { Router } from "express";
import { TaskController } from "../controllers/TaskController";
import { BudgetRevisionController } from "../controllers/BudgetRevisionController";
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

// ── Global Budget Revision ───────────────────────────────────────────────────
// POST /api/v1/tasks/:taskId/revise-budget — Poster revises task budget (max 1 round)
router.post(
  "/:taskId/revise-budget",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(BudgetRevisionController.reviseBudget)
);

export default router;
