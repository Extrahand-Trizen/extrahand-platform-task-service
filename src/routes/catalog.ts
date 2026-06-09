import { Router } from 'express';
import { CatalogController } from '../controllers/CatalogController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.use(serviceAuthMiddleware);

router.get('/categories', asyncHandler(CatalogController.listCategories));
router.get('/categories/:slug', asyncHandler(CatalogController.getCategory));
router.get('/skus/:skuSlug', asyncHandler(CatalogController.getSku));
router.get('/areas', asyncHandler(CatalogController.listAreas));
router.get('/areas/check', asyncHandler(CatalogController.checkPinCode));

export default router;
