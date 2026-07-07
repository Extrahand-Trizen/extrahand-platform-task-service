import { Router } from 'express';
import { CatalogController } from '../controllers/CatalogController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { optionalAuthMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.use(serviceAuthMiddleware);
router.use(optionalAuthMiddleware);

router.get('/categories', asyncHandler(CatalogController.listCategories));
router.get('/categories/:slug', asyncHandler(CatalogController.getCategory));
router.get('/skus/:skuSlug', asyncHandler(CatalogController.getSku));
router.get('/areas', asyncHandler(CatalogController.listAreas));

export default router;
