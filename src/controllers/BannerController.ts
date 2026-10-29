import { Request, Response } from 'express';
import { BannerService } from '../services/BannerService';
import { BannerPlacement } from '../models/AppBanner';
import { emitBannersUpdated } from '../socket/taskSocketEmitter';

export class BannerController {
  static async listBanners(req: Request, res: Response): Promise<void> {
    const placement = req.query.placement ? (String(req.query.placement) as BannerPlacement) : undefined;
    const activeOnly = req.query.activeOnly !== 'false';
    const data = await BannerService.listBanners({ placement, activeOnly });
    res.json({ success: true, data });
  }

  static async listAdminBanners(req: Request, res: Response): Promise<void> {
    const placement = req.query.placement ? (String(req.query.placement) as BannerPlacement) : undefined;
    const data = await BannerService.listBanners({ placement, activeOnly: false });
    res.json({ success: true, data });
  }

  static async getBannerById(req: Request, res: Response): Promise<void> {
    const banner = await BannerService.getBannerById(String(req.params.id));
    res.json({ success: true, data: banner });
  }

  static async createBanner(req: Request, res: Response): Promise<void> {
    const banner = await BannerService.createBanner(req.body);
    try {
      emitBannersUpdated({ placement: banner?.placement });
    } catch {}
    res.status(201).json({ success: true, data: banner });
  }

  static async updateBanner(req: Request, res: Response): Promise<void> {
    const banner = await BannerService.updateBanner(String(req.params.id), req.body);
    try {
      emitBannersUpdated({ placement: banner?.placement });
    } catch {}
    res.json({ success: true, data: banner });
  }

  static async deleteBanner(req: Request, res: Response): Promise<void> {
    await BannerService.deleteBanner(String(req.params.id));
    try {
      emitBannersUpdated();
    } catch {}
    res.json({ success: true, message: 'Banner deleted successfully' });
  }

  static async reorderBanners(req: Request, res: Response): Promise<void> {
    await BannerService.reorderBanners(req.body.orderedIds);
    try {
      emitBannersUpdated();
    } catch {}
    res.json({ success: true, message: 'Banners reordered successfully' });
  }
}
