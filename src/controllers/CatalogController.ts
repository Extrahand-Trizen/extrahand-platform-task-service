import { Request, Response } from 'express';
import { CatalogService } from '../services/CatalogService';
import { AuthenticatedRequest } from '../types';
import logger from '../config/logger';

export class CatalogController {
  static async listCategories(_req: Request, res: Response): Promise<void> {
    const categories = await CatalogService.listCategories();
    res.json({ success: true, data: categories });
  }

  static async getCategory(req: Request, res: Response): Promise<void> {
    const category = await CatalogService.getCategoryBySlug(req.params.slug);
    const { skus } = await CatalogService.listSkusByCategorySlug(req.params.slug);
    res.json({ success: true, data: { category, skus } });
  }

  static async getSku(req: Request, res: Response): Promise<void> {
    const categorySlug = req.query.categorySlug as string | undefined;
    const detail = await CatalogService.getSkuDetail(req.params.skuSlug, categorySlug);
    res.json({ success: true, data: detail });
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
