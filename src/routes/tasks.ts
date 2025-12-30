import { Router } from "express";
import { TaskController } from "../controllers/TaskController";
import { authMiddleware } from "../middleware/auth";
import { serviceAuthMiddleware } from "../middleware/serviceAuth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();

// ✅ All routes require service auth (verify request is from API Gateway) AND user auth
// GET /api/v1/tasks - Get all tasks
router.get("/", serviceAuthMiddleware, asyncHandler(TaskController.getTasks));

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

// GET /api/v1/tasks/:id - Get a single task
router.get(
  "/:id",
  serviceAuthMiddleware,
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

// POST /api/v1/tasks/:id/submit-proof - Submit completion proof for review
router.post(
  "/:id/submit-proof",
  serviceAuthMiddleware,
  authMiddleware,
  asyncHandler(TaskController.submitCompletionProof)
);

export default router;
