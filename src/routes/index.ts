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
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Health check endpoint (no auth required)
router.get('/health', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    service: 'extrahand-task-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}));

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

export default router;

