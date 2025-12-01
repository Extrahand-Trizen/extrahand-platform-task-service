import { Router } from 'express';
import { QuestionController } from '../controllers/QuestionController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All question routes require authentication
router.use(authMiddleware);

// POST /api/v1/tasks/:taskId/questions - Ask a question
router.post('/tasks/:taskId/questions', asyncHandler(QuestionController.askQuestion));

// GET /api/v1/tasks/:taskId/questions - Get all questions for a task
router.get('/tasks/:taskId/questions', asyncHandler(QuestionController.getTaskQuestions));

// POST /api/v1/tasks/:taskId/questions/:questionId/answer - Answer a question
router.post('/tasks/:taskId/questions/:questionId/answer', asyncHandler(QuestionController.answerQuestion));

// DELETE /api/v1/tasks/:taskId/questions/:questionId - Delete a question
router.delete('/tasks/:taskId/questions/:questionId', asyncHandler(QuestionController.deleteQuestion));

export default router;



