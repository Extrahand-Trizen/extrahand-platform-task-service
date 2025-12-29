import { Router } from 'express';
import { TaskController } from '../controllers/TaskController';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// ✅ PUBLIC routes (with optional auth for personalization)
// GET /api/v1/tasks - Get all tasks (public, but can show personalized data if authenticated)
router.get('/', optionalAuthMiddleware, asyncHandler(TaskController.getTasks));

// GET /api/v1/tasks/:id - Get a single task (public, but can show additional info if authenticated)
router.get('/:id', optionalAuthMiddleware, asyncHandler(TaskController.getTask));

// ✅ PROTECTED routes (require authentication)
// GET /api/v1/tasks/nearby - Get nearby tasks (requires user location from profile)
router.get('/nearby', authMiddleware, asyncHandler(TaskController.getNearbyTasks));

// GET /api/v1/tasks/my-tasks - Get tasks posted by current user
router.get('/my-tasks', authMiddleware, asyncHandler(TaskController.getMyTasks));

// GET /api/v1/tasks/:id/applications - Get applications for a task
router.get('/:id/applications', authMiddleware, asyncHandler(TaskController.getTaskApplications));

// POST /api/v1/tasks - Create a new task
router.post('/', authMiddleware, asyncHandler(TaskController.createTask));

// PUT /api/v1/tasks/:id - Update a task
router.put('/:id', authMiddleware, asyncHandler(TaskController.updateTask));

// DELETE /api/v1/tasks/:id - Delete a task
router.delete('/:id', authMiddleware, asyncHandler(TaskController.deleteTask));

// PATCH /api/v1/tasks/:id/status - Update task status
router.patch('/:id/status', authMiddleware, asyncHandler(TaskController.updateTaskStatus));

// POST /api/v1/tasks/:id/submit-proof - Submit completion proof for review
router.post('/:id/submit-proof', authMiddleware, asyncHandler(TaskController.submitCompletionProof));

export default router;

