import { Router } from "express";
import { ApplicationController } from "../controllers/ApplicationController";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();

// GET /api/v1/applications - Get applications (public with optional auth)
router.get("/", optionalAuthMiddleware, asyncHandler(ApplicationController.getApplications));

// All other application routes require authentication
router.use(authMiddleware);

// POST /api/v1/applications - Submit application
router.post("/", asyncHandler(ApplicationController.submitApplication));

// GET /api/v1/applications - Get applications
router.get("/", asyncHandler(ApplicationController.getApplications));

// GET /api/v1/applications/:id - Get application by ID
router.get("/:id", asyncHandler(ApplicationController.getApplication));

// PUT /api/v1/applications/:id - Update application status (accept/reject)
router.put("/:id", asyncHandler(ApplicationController.updateApplication));

// POST /api/v1/applications/:id/accept - Accept an application (legacy)
router.post(
  "/:id/accept",
  asyncHandler(ApplicationController.acceptApplication)
);

// POST /api/v1/applications/:id/reject - Reject an application (legacy)
router.post(
  "/:id/reject",
  asyncHandler(ApplicationController.rejectApplication)
);

// POST /api/v1/applications/:id/withdraw-pending - Withdraw a pending application
router.post(
  "/:id/withdraw-pending",
  asyncHandler(ApplicationController.withdrawPendingApplication)
);

// POST /api/v1/applications/:id/withdraw-accepted - Withdraw an accepted application
router.post(
  "/:id/withdraw-accepted",
  asyncHandler(ApplicationController.withdrawAcceptedApplication)
);

// DELETE /api/v1/applications/:id - Withdraw an application (Alias for backward compatibility)
router.delete("/:id", asyncHandler(ApplicationController.withdrawApplication));

export default router;
