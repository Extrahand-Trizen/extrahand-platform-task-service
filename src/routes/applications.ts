import { Router } from 'express';
import { ApplicationController } from '../controllers/ApplicationController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All application routes require authentication
router.use(authMiddleware);

// POST /api/v1/applications - Submit application
router.post('/', asyncHandler(ApplicationController.submitApplication));

// GET /api/v1/applications - Get applications
router.get('/', asyncHandler(ApplicationController.getApplications));

// PUT /api/v1/applications/:id - Update application status (accept/reject)
router.put('/:id', asyncHandler(ApplicationController.updateApplication));

// POST /api/v1/applications/:id/accept - Accept an application (legacy)
router.post('/:id/accept', asyncHandler(ApplicationController.acceptApplication));

// POST /api/v1/applications/:id/reject - Reject an application (legacy)
router.post('/:id/reject', asyncHandler(ApplicationController.rejectApplication));

// DELETE /api/v1/applications/:id - Withdraw an application
router.delete('/:id', asyncHandler(ApplicationController.withdrawApplication));

export default router;

