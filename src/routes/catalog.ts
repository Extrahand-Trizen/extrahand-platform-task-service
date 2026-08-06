import { Router } from 'express';
import { CatalogController } from '../controllers/CatalogController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { optionalAuthMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.use(serviceAuthMiddleware);
router.use(optionalAuthMiddleware);

router.get('/internal/skus/content', asyncHandler(CatalogController.listSkuContent));
router.post('/internal/skus/content', asyncHandler(CatalogController.upsertSkuContent));
router.patch('/internal/skus/content/:id', asyncHandler(CatalogController.patchSkuContent));
router.get('/internal/skus/operational', asyncHandler(CatalogController.listOperationalSkus));
router.patch(
  '/internal/skus/operational/:id/offer',
  asyncHandler(CatalogController.patchOperationalSkuOffer),
);
router.get('/internal/categories/content', asyncHandler(CatalogController.listCategoryContent));
router.post('/internal/categories/content', asyncHandler(CatalogController.upsertCategoryContent));
router.patch(
  '/internal/categories/content/:id',
  asyncHandler(CatalogController.patchCategoryContent),
);
router.get('/internal/hub-sections', asyncHandler(CatalogController.listHubSectionsAdmin));
router.post('/internal/hub-sections', asyncHandler(CatalogController.upsertHubSection));
router.patch('/internal/hub-sections/:id', asyncHandler(CatalogController.patchHubSection));
router.get(
  '/internal/help-support/:variant',
  asyncHandler(CatalogController.listHelpSupportCategoriesAdmin),
);
router.put(
  '/internal/help-support/:variant/:categoryKey',
  asyncHandler(CatalogController.upsertHelpSupportCategory),
);
router.patch('/internal/help-support/:id', asyncHandler(CatalogController.patchHelpSupportCategory));

router.get('/categories', asyncHandler(CatalogController.listCategories));
router.get('/book-now/hub', asyncHandler(CatalogController.getBookNowHubCatalog));
router.get('/categories/:slug/packages', asyncHandler(CatalogController.getBookNowCategoryPackages));
router.get('/categories/:slug/content', asyncHandler(CatalogController.getCategoryContent));
router.get('/categories/:slug', asyncHandler(CatalogController.getCategory));
router.get('/skus/content/resolve', asyncHandler(CatalogController.resolveSkuContent));
router.get('/skus/:skuSlug', asyncHandler(CatalogController.getSku));
router.get('/skus/:skuSlug/content', asyncHandler(CatalogController.getSkuContent));
router.get('/help-support/:variant', asyncHandler(CatalogController.listHelpSupportCategories));
router.get(
  '/help-support/:variant/:categoryKey',
  asyncHandler(CatalogController.getHelpSupportCategory),
);
router.get('/areas', asyncHandler(CatalogController.listAreas));

export default router;
