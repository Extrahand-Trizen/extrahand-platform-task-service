import { Router } from 'express';
import { TaskController } from '../controllers/TaskController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All task routes require authentication
router.use(authMiddleware);

// GET /api/v1/tasks - Get all tasks
router.get('/', asyncHandler(TaskController.getTasks));

// GET /api/v1/tasks/nearby - Get nearby tasks
router.get('/nearby', asyncHandler(TaskController.getNearbyTasks));

// GET /api/v1/tasks/my-tasks - Get tasks posted by current user
router.get('/my-tasks', asyncHandler(TaskController.getMyTasks));

// GET /api/v1/tasks/:id - Get a single task
router.get('/:id', asyncHandler(TaskController.getTask));

// POST /api/v1/tasks - Create a new task
router.post('/', asyncHandler(TaskController.createTask));

// PUT /api/v1/tasks/:id - Update a task
router.put('/:id', asyncHandler(TaskController.updateTask));

// DELETE /api/v1/tasks/:id - Delete a task
router.delete('/:id', asyncHandler(TaskController.deleteTask));

// PATCH /api/v1/tasks/:id/status - Update task status
router.patch('/:id/status', asyncHandler(TaskController.updateTaskStatus));

export default router;

