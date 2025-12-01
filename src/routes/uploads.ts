import { Router } from 'express';
import multer from 'multer';
import { UploadController } from '../controllers/UploadController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Configure multer for memory storage
const multerMemoryStorage = multer.memoryStorage();
const upload = multer({
  storage: multerMemoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per file
  },
  fileFilter: (_req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// All upload routes require authentication
router.use(authMiddleware);

// POST /api/v1/uploads/completion-proof/:taskId
// Upload single completion proof image
router.post(
  '/completion-proof/:taskId',
  upload.single('image'),
  asyncHandler(UploadController.uploadCompletionProof)
);

// POST /api/v1/uploads/completion-proof/:taskId/multiple
// Upload multiple completion proof images
router.post(
  '/completion-proof/:taskId/multiple',
  upload.array('images', 10), // Max 10 images
  asyncHandler(UploadController.uploadMultipleCompletionProofs)
);

// DELETE /api/v1/uploads/completion-proof/:taskId
// Delete completion proof image
router.delete(
  '/completion-proof/:taskId',
  asyncHandler(UploadController.deleteCompletionProof)
);

// GET /api/v1/uploads/health
// Health check for storage service (public, no auth required)
router.get('/health', asyncHandler(async (_req, res) => {
  const { healthCheck, getStorageType } = await import('../utils/storageManager');
  const isHealthy = await healthCheck();
  const provider = getStorageType();
  
  res.json({
    success: true,
    data: {
      provider,
      healthy: isHealthy,
      timestamp: new Date().toISOString()
    }
  });
}));

export default router;


