import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { BookServicesAssistantController } from '../controllers/BookServicesAssistantController';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const assistantRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req as AuthenticatedRequest).user?.uid?.trim() || 'authenticated-user-missing',
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many assistant requests',
      message: 'Please wait before trying again.',
    });
  },
});

router.use(authMiddleware, assistantRateLimit);

router.post('/conversations', asyncHandler(BookServicesAssistantController.startConversation));
router.get(
  '/conversations/:conversationId',
  asyncHandler(BookServicesAssistantController.getConversation),
);
router.post(
  '/conversations/:conversationId/messages',
  asyncHandler(BookServicesAssistantController.sendMessage),
);
router.post(
  '/conversations/:conversationId/end',
  asyncHandler(BookServicesAssistantController.endConversation),
);

export default router;
