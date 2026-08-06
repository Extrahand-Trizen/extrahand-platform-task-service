import { Request, Response } from 'express';
import { CatalogService } from '../services/CatalogService';
import { AuthenticatedRequest } from '../types';
import logger from '../config/logger';
import { BadRequestError, ValidationError } from '../errors/AppError';
import {
  helpSupportVariantSchema,
  patchCategoryContentSchema,
  patchHelpSupportCategorySchema,
  patchHubSectionSchema,
  patchOperationalSkuOfferSchema,
  patchSkuContentSchema,
  upsertCategoryContentSchema,
  upsertHelpSupportCategorySchema,
  upsertHubSectionSchema,
  upsertSkuContentSchema,
} from '../schemas/catalogContent';
import { parseWithZod } from '../utils/parseWithZod';

function parseIncludeInactive(value: unknown): boolean {
  if (value === true || value === 'true' || value === '1') return true;
  return false;
}

export class CatalogController {
  static async listCategories(_req: Request, res: Response): Promise<void> {
    const categories = await CatalogService.listCategories();
    res.json({ success: true, data: categories });
  }

  static async getCategory(req: Request, res: Response): Promise<void> {
    const { category, skus, content } = await CatalogService.listSkusByCategorySlug(req.params.slug);
    res.json({ success: true, data: { category, skus, content } });
  }

  static async getBookNowHubCatalog(req: Request, res: Response): Promise<void> {
    const previewLimit =
      req.query.previewLimit !== undefined ? Number(req.query.previewLimit) : undefined;
    const sections = await CatalogService.getBookNowHubCatalog(previewLimit);
    res.json({ success: true, data: sections });
  }

  static async getBookNowCategoryPackages(req: Request, res: Response): Promise<void> {
    const data = await CatalogService.getBookNowCategoryPackages(req.params.slug);
    res.json({ success: true, data });
  }

  static async getCategoryContent(req: Request, res: Response): Promise<void> {
    const content = await CatalogService.getCategoryContent(req.params.slug);
    res.json({ success: true, data: content });
  }

  static async listCategoryContent(req: Request, res: Response): Promise<void> {
    const includeInactive = parseIncludeInactive(req.query.includeInactive);
    const content = await CatalogService.listCategoryContent({ includeInactive });
    res.json({ success: true, data: content });
  }

  static async upsertCategoryContent(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(upsertCategoryContentSchema, req.body || {});
    const content = await CatalogService.upsertCategoryContent(input);
    res.json({ success: true, data: content });
  }

  static async patchCategoryContent(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(patchCategoryContentSchema, req.body || {});
    const content = await CatalogService.patchCategoryContent(req.params.id, input);
    res.json({ success: true, data: content });
  }

  static async listHubSectionsAdmin(req: Request, res: Response): Promise<void> {
    const includeInactive = parseIncludeInactive(req.query.includeInactive);
    const sections = await CatalogService.listHubSections({ includeInactive });
    res.json({ success: true, data: sections });
  }

  static async upsertHubSection(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(upsertHubSectionSchema, req.body || {});
    const section = await CatalogService.upsertHubSection(input);
    res.json({ success: true, data: section });
  }

  static async patchHubSection(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(patchHubSectionSchema, req.body || {});
    const section = await CatalogService.patchHubSection(req.params.id, input);
    res.json({ success: true, data: section });
  }

  static async getSku(req: Request, res: Response): Promise<void> {
    const categorySlug = req.query.categorySlug as string | undefined;
    const detail = await CatalogService.getSkuDetail(req.params.skuSlug, categorySlug);
    res.json({ success: true, data: detail });
  }

  static async getSkuContent(req: Request, res: Response): Promise<void> {
    const categorySlug = req.query.categorySlug as string | undefined;
    const content = await CatalogService.getSkuContent(req.params.skuSlug, categorySlug);
    res.json({ success: true, data: content });
  }

  static async resolveSkuContent(req: Request, res: Response): Promise<void> {
    const categorySlug = String(req.query.categorySlug || '').trim();
    if (!categorySlug) {
      throw new BadRequestError('categorySlug is required');
    }
    const taskTitle = typeof req.query.taskTitle === 'string' ? req.query.taskTitle : undefined;
    const skuSlug = typeof req.query.skuSlug === 'string' ? req.query.skuSlug : undefined;

    const content = await CatalogService.resolveSkuContent({
      categorySlug,
      taskTitle,
      skuSlug,
    });
    res.json({ success: true, data: content });
  }

  static async listSkuContent(req: Request, res: Response): Promise<void> {
    const includeInactive = parseIncludeInactive(req.query.includeInactive);
    const categorySlug =
      typeof req.query.categorySlug === 'string' ? req.query.categorySlug.trim() : undefined;
    const content = await CatalogService.listSkuContent({
      includeInactive,
      categorySlug: categorySlug || undefined,
    });
    res.json({ success: true, data: content });
  }

  static async upsertSkuContent(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(upsertSkuContentSchema, req.body || {});
    const content = await CatalogService.upsertSkuContent(input);
    res.json({ success: true, data: content });
  }

  static async patchSkuContent(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(patchSkuContentSchema, req.body || {});
    const content = await CatalogService.patchSkuContent(req.params.id, input);
    res.json({ success: true, data: content });
  }

  static async listOperationalSkus(req: Request, res: Response): Promise<void> {
    const includeInactive = parseIncludeInactive(req.query.includeInactive);
    const categorySlug =
      typeof req.query.categorySlug === 'string' ? req.query.categorySlug.trim() : undefined;
    const skus = await CatalogService.listOperationalSkus({
      includeInactive,
      categorySlug: categorySlug || undefined,
    });
    res.json({ success: true, data: skus });
  }

  static async patchOperationalSkuOffer(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(patchOperationalSkuOfferSchema, req.body || {});
    const sku = await CatalogService.patchOperationalSkuOffer(req.params.id, input);
    res.json({ success: true, data: sku });
  }

  static async listHelpSupportCategories(req: Request, res: Response): Promise<void> {
    const variant = parseWithZod(helpSupportVariantSchema, String(req.params.variant || '').trim());
    const categories = await CatalogService.listHelpSupportCategories(variant);
    res.json({ success: true, data: categories });
  }

  static async listHelpSupportCategoriesAdmin(req: Request, res: Response): Promise<void> {
    const variant = parseWithZod(helpSupportVariantSchema, String(req.params.variant || '').trim());
    const includeInactive = parseIncludeInactive(req.query.includeInactive);
    const categories = await CatalogService.listHelpSupportCategories(variant, {
      includeInactive,
    });
    res.json({ success: true, data: categories });
  }

  static async getHelpSupportCategory(req: Request, res: Response): Promise<void> {
    const variant = parseWithZod(helpSupportVariantSchema, String(req.params.variant || '').trim());
    const categoryKey = String(req.params.categoryKey || '').trim();
    if (!categoryKey) {
      throw new ValidationError('categoryKey is required');
    }
    const category = await CatalogService.getHelpSupportCategory(variant, categoryKey);
    res.json({ success: true, data: category });
  }

  static async upsertHelpSupportCategory(req: Request, res: Response): Promise<void> {
    const variant = parseWithZod(helpSupportVariantSchema, String(req.params.variant || '').trim());
    const categoryKey = String(req.params.categoryKey || '').trim();
    const input = parseWithZod(upsertHelpSupportCategorySchema, {
      ...(req.body || {}),
      variant,
      categoryKey,
    });
    const category = await CatalogService.upsertHelpSupportCategory(input);
    res.json({ success: true, data: category });
  }

  static async patchHelpSupportCategory(req: Request, res: Response): Promise<void> {
    const input = parseWithZod(patchHelpSupportCategorySchema, req.body || {});
    const category = await CatalogService.patchHelpSupportCategory(req.params.id, input);
    res.json({ success: true, data: category });
  }

  static async listAreas(req: Request, res: Response): Promise<void> {
    const city = req.query.city as string | undefined;
    const areas = await CatalogService.listServiceAreas(city);
    res.json({ success: true, data: areas });
  }

  static async checkPinCode(req: Request, res: Response): Promise<void> {
    const pinCode = String(req.query.pinCode || '').trim();
    const city = req.query.city as string | undefined;
    const lat =
      req.query.lat !== undefined ? parseFloat(String(req.query.lat)) : undefined;
    const lng =
      req.query.lng !== undefined ? parseFloat(String(req.query.lng)) : undefined;
    const customerUid = [
      typeof req.query.firebaseUid === 'string' ? req.query.firebaseUid.trim() : '',
      (req as AuthenticatedRequest).user?.uid,
      typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'].trim() : '',
    ].find((value) => Boolean(value));

    const result = await CatalogService.checkBookNowArea({
      pinCode: pinCode || undefined,
      city,
      customerUid,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    });

    logger.info('Book Now areas/check result', {
      customerUid: customerUid || null,
      city: city || null,
      pinCode: pinCode || null,
      serviceable: result.serviceable,
      hasHelpers: result.hasHelpers,
      count: result.count,
      checkPerformed: result.checkPerformed,
      resolvedCity: result.resolvedCity,
    });

    res.json({
      success: true,
      data: {
        pinCode,
        city,
        resolvedCity: result.resolvedCity,
        serviceable: result.serviceable,
        hasHelpers: result.hasHelpers,
        count: result.count,
        checkPerformed: result.checkPerformed,
      },
    });
  }
}
