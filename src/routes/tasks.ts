import { Router } from "express";
import { TaskController } from "../controllers/TaskController";
import { BudgetRevisionController } from "../controllers/BudgetRevisionController";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { serviceAuthMiddleware } from "../middleware/serviceAuth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// STATIC / COLLECTION routes  (must come before /:id to avoid param capture)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/v1/tasks
router.get("/", serviceAuthMiddleware, optionalAuthMiddleware, asyncHandler(TaskController.getTasks));

// POST /api/v1/tasks
router.post("/", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.createTask));

// GET /api/v1/tasks/nearby
router.get("/nearby", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.getNearbyTasks));

// GET /api/v1/tasks/my-tasks
router.get("/my-tasks", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.getMyTasks));

// GET /api/v1/tasks/my  (backward-compat alias)
router.get("/my", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.getMyTasks));

// GET /api/v1/tasks/count/open
router.get("/count/open", serviceAuthMiddleware, optionalAuthMiddleware, asyncHandler(TaskController.getOpenTaskCount));

// ─────────────────────────────────────────────────────────────────────────────
// /:id  SUB-ROUTES  (must come before the bare /:id GET to avoid being swallowed)
// ─────────────────────────────────────────────────────────────────────────────

// PUT /api/v1/tasks/:id
router.put("/:id", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.updateTask));

// DELETE /api/v1/tasks/:id
router.delete("/:id", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.deleteTask));

// PATCH /api/v1/tasks/:id/status
router.patch("/:id/status", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.updateTaskStatus));

// POST /api/v1/tasks/:id/start-otp/send
router.post("/:id/start-otp/send", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.sendStartOtp));

// POST /api/v1/tasks/:id/start-otp/resend
router.post("/:id/start-otp/resend", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.resendStartOtp));

// POST /api/v1/tasks/:id/start-otp/verify
router.post("/:id/start-otp/verify", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.verifyStartOtp));

// POST /api/v1/tasks/:id/mark-reached  (assigned → reached, selfie only, no OTP)
router.post("/:id/mark-reached", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.markReached));

// POST /api/v1/tasks/:id/mark-started  (reached → started, requires work photo)
router.post("/:id/mark-started", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.markStarted));

// POST /api/v1/tasks/:id/submit-proof
router.post("/:id/submit-proof", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.submitCompletionProof));

// POST /api/v1/tasks/:id/request-changes
router.post("/:id/request-changes", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.requestChanges));

// ── Additional Quote Requests ─────────────────────────────────────────────────

// POST /api/v1/tasks/:id/additional-quote-request
router.post("/:id/additional-quote-request", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.createAdditionalQuoteRequest));

// GET /api/v1/tasks/:id/additional-quote-requests  (all)
router.get("/:id/additional-quote-requests", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.getAdditionalQuoteRequests));

// GET /api/v1/tasks/:id/additional-quote-request/active
// ⚠️ Must be before /:id/additional-quote-request/:requestId/* routes
router.get("/:id/additional-quote-request/active", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.getActiveAdditionalQuoteRequest));

// POST /api/v1/tasks/:id/additional-quote-request/:requestId/accept
router.post("/:id/additional-quote-request/:requestId/accept", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.acceptAdditionalQuoteRequest));

// POST /api/v1/tasks/:id/additional-quote-request/:requestId/create-payment-order
router.post("/:id/additional-quote-request/:requestId/create-payment-order", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.createAdditionalPaymentOrder));

// POST /api/v1/tasks/:id/additional-quote-request/:requestId/mark-paid
router.post("/:id/additional-quote-request/:requestId/mark-paid", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.markAdditionalPaymentPaid));

// Dedicated payment-complete route — called by payment service after Razorpay verification
// Uses serviceAuthMiddleware only (no Firebase auth needed for service-to-service calls)
router.post("/:id/additional-payment-complete/:requestId", serviceAuthMiddleware, asyncHandler(TaskController.markAdditionalPaymentPaidByService));

// POST /api/v1/tasks/:id/additional-quote-request/:requestId/reject
router.post("/:id/additional-quote-request/:requestId/reject", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.rejectAdditionalQuoteRequest));

// POST /api/v1/tasks/:id/additional-quote-request/:requestId/withdraw
router.post("/:id/additional-quote-request/:requestId/withdraw", serviceAuthMiddleware, authMiddleware, asyncHandler(TaskController.withdrawAdditionalQuoteRequest));

// ── Global Budget Revision ────────────────────────────────────────────────────

// POST /api/v1/tasks/:taskId/revise-budget
router.post("/:taskId/revise-budget", serviceAuthMiddleware, authMiddleware, asyncHandler(BudgetRevisionController.reviseBudget));

// ─────────────────────────────────────────────────────────────────────────────
// BARE /:id GET — must be LAST so it doesn't swallow sub-routes above
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/v1/tasks/:id
router.get("/:id", serviceAuthMiddleware, optionalAuthMiddleware, asyncHandler(TaskController.getTask));

export default router;
