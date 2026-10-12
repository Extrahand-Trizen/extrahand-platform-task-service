import { Request, Response } from 'express';
import { LocationPricingService } from '../services/LocationPricingService';
import { HourlyHelperLocationAvailabilityService } from '../services/HourlyHelperLocationAvailabilityService';
import { LocationType } from '../models/HourlyHelperLocationAvailability';

export class LocationPricingController {
  static async ensureCanonicalLocation(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await LocationPricingService.ensureCanonicalLocation(req.body || {}) });
  }

  static async listLocations(req: Request, res: Response): Promise<void> {
    const isActive = req.query.isActive === undefined ? undefined : req.query.isActive === 'true';
    const data = await LocationPricingService.listLocations({
      search: String(req.query.search || ''),
      type: req.query.type ? String(req.query.type) : undefined,
      stateId: req.query.stateId ? String(req.query.stateId) : undefined,
      cityId: req.query.cityId ? String(req.query.cityId) : undefined,
      isActive,
    });
    res.json({ success: true, data });
  }

  static async createLocation(req: Request, res: Response): Promise<void> {
    const data = await LocationPricingService.createLocation(String(req.params.type), req.body || {});
    res.status(201).json({ success: true, data });
  }

  static async updateLocation(req: Request, res: Response): Promise<void> {
    const data = await LocationPricingService.updateLocation(String(req.params.type), String(req.params.id), req.body || {});
    res.json({ success: true, data });
  }

  static async activateLocation(req: Request, res: Response): Promise<void> {
    const data = await LocationPricingService.setLocationActive(String(req.params.type), String(req.params.id), true);
    res.json({ success: true, data });
  }

  static async deactivateLocation(req: Request, res: Response): Promise<void> {
    const data = await LocationPricingService.setLocationActive(String(req.params.type), String(req.params.id), false);
    res.json({ success: true, data });
  }

  static async listHourlySkus(_req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await LocationPricingService.listHourlySkus() });
  }

  static async listPricingCategories(_req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await LocationPricingService.listPricingCategories() });
  }

  static async listPricingSkus(req: Request, res: Response): Promise<void> {
    const categoryId = req.query.categoryId ? String(req.query.categoryId) : undefined;
    const sectionId = req.query.sectionId ? String(req.query.sectionId) : undefined;
    res.json({ success: true, data: await LocationPricingService.listPricingSkus({ categoryId, sectionId }) });
  }

  static async listHourlyPrices(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await LocationPricingService.listHourlyPrices(req.query.skuId ? String(req.query.skuId) : undefined) });
  }

  static async createHourlyPrice(req: Request, res: Response): Promise<void> {
    res.status(201).json({ success: true, data: await LocationPricingService.createHourlyPrice(req.body || {}) });
  }

  static async updateHourlyPrice(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await LocationPricingService.updateHourlyPrice(String(req.params.id), req.body || {}) });
  }

  static async updateSkuGlobalPrice(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await LocationPricingService.updateSkuGlobalPrice(String(req.params.id), Number(req.body.offerPrice)) });
  }

  static async resolveHourlyPrice(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await LocationPricingService.resolveHourlyPrice(req.body || {}) });
  }

  static async resolveAddress(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await LocationPricingService.resolveAddress(req.body || {}) });
  }

  static async listHourlyHelperAvailabilities(req: Request, res: Response): Promise<void> {
    const isEnabled = req.query.isEnabled === undefined ? undefined : req.query.isEnabled === 'true';
    const type = req.query.type ? (String(req.query.type) as LocationType) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const data = await HourlyHelperLocationAvailabilityService.listLocationAvailabilities({
      search,
      type,
      isEnabled,
    });
    res.json({ success: true, data });
  }

  static async toggleHourlyHelperAvailability(req: Request, res: Response): Promise<void> {
    const { type, id } = req.params;
    const isEnabled = req.body.isEnabled !== undefined ? Boolean(req.body.isEnabled) : true;
    const updatedBy = req.body.updatedBy
      ? String(req.body.updatedBy)
      : (req as any).user?.email || (req as any).user?.uid || 'admin';
    const data = await HourlyHelperLocationAvailabilityService.setLocationAvailability({
      locationType: type as LocationType,
      locationId: id,
      isEnabled,
      updatedBy,
    });
    res.json({ success: true, data });
  }
}
