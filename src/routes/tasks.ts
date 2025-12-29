import { Router } from 'express';
import { TaskController } from '../controllers/TaskController';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All task routes require authentication
// Wrap async authMiddleware to handle errors properly
router.use((req, res, next) => {
  Promise.resolve(authMiddleware(req, res, next)).catch(next);
});

// GET /api/v1/tasks - Get all tasks
router.get('/',optionalAuthMiddleware, asyncHandler(TaskController.getTasks));

// POST /api/v1/tasks - Create a new task (must come before /:id route)
router.post('/', asyncHandler(TaskController.createTask));

// ✅ PROTECTED routes (require authentication)
// GET /api/v1/tasks/nearby - Get nearby tasks (requires user location from profile)
router.get('/nearby', authMiddleware, asyncHandler(TaskController.getNearbyTasks));

// GET /api/v1/tasks/my-tasks - Get tasks posted by current user
router.get('/my-tasks', authMiddleware, asyncHandler(TaskController.getMyTasks));

// GET /api/v1/tasks/:id - Get a single task (public, but can show additional info if authenticated)
router.get('/:id', optionalAuthMiddleware, asyncHandler(TaskController.getTask));

// GET /api/v1/tasks/:id - Get a single task
router.get('/:id', asyncHandler(TaskController.getTask));

// PUT /api/v1/tasks/:id - Update a task
router.put('/:id', authMiddleware, asyncHandler(TaskController.updateTask));

// DELETE /api/v1/tasks/:id - Delete a task
router.delete('/:id', authMiddleware, asyncHandler(TaskController.deleteTask));

// PATCH /api/v1/tasks/:id/status - Update task status
router.patch('/:id/status', authMiddleware, asyncHandler(TaskController.updateTaskStatus));

// POST /api/v1/tasks/:id/submit-proof - Submit completion proof for review
router.post('/:id/submit-proof', authMiddleware, asyncHandler(TaskController.submitCompletionProof));

export default router;

