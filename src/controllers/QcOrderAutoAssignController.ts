import { Request, Response } from 'express';
import { QcOrderAutoAssignService } from '../services/QcOrderAutoAssignService';

export class QcOrderAutoAssignController {
  /**
   * Service-to-service: trigger auto-assign for a Quick Commerce order
   * after payment is confirmed.
   */
  static async autoAssign(req: Request, res: Response): Promise<void> {
    const { orderId, orderNumber, sellerId, shopName, shopCoordinates, shopAddress } = req.body;

    if (!orderId || !orderNumber) {
      res.status(400).json({ success: false, error: 'orderId and orderNumber are required' });
      return;
    }

    // Resolve shop coordinates if not provided directly
    let coordinates = shopCoordinates;
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      coordinates = await QcOrderAutoAssignService.resolveShopCoordinates(sellerId, shopName);
    }

    const result = await QcOrderAutoAssignService.autoAssign({
      orderId,
      orderNumber,
      sellerId,
      shopName,
      shopCoordinates: coordinates,
      shopAddress,
    });

    res.json({ success: true, data: result });
  }
}
