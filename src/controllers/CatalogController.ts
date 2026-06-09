import { Request, Response } from 'express';
import { CatalogService } from '../services/CatalogService';
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
    const pinCode = String(req.query.pinCode || '');
    const city = req.query.city as string | undefined;
    const serviceable = pinCode
      ? await CatalogService.isPinCodeServiceable(pinCode, city)
      : false;
    res.json({ success: true, data: { pinCode, city, serviceable } });
  }
}
