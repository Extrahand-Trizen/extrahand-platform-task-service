import { Router } from 'express';
import { TaskController } from '../controllers/TaskController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All task routes require authentication
// Wrap async authMiddleware to handle errors properly
router.use((req, res, next) => {
  Promise.resolve(authMiddleware(req, res, next)).catch(next);
});

// GET /api/v1/tasks - Get all tasks
router.get('/', asyncHandler(TaskController.getTasks));

// POST /api/v1/tasks - Create a new task (must come before /:id route)
router.post('/', asyncHandler(TaskController.createTask));

// GET /api/v1/tasks/nearby - Get nearby tasks
router.get('/nearby', asyncHandler(TaskController.getNearbyTasks));

// GET /api/v1/tasks/my-tasks - Get tasks posted by current user
router.get('/my-tasks', asyncHandler(TaskController.getMyTasks));

// GET /api/v1/tasks/:id/applications - Get applications for a task (must come before /:id route)
router.get('/:id/applications', asyncHandler(TaskController.getTaskApplications));

// GET /api/v1/tasks/:id - Get a single task
router.get('/:id', asyncHandler(TaskController.getTask));

// PUT /api/v1/tasks/:id - Update a task
router.put('/:id', asyncHandler(TaskController.updateTask));

// DELETE /api/v1/tasks/:id - Delete a task
router.delete('/:id', asyncHandler(TaskController.deleteTask));

// PATCH /api/v1/tasks/:id/status - Update task status
router.patch('/:id/status', asyncHandler(TaskController.updateTaskStatus));

export default router;

