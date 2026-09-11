import { Request, Response } from 'express';
import { QcOrderAutoAssignService } from '../services/QcOrderAutoAssignService';

export class QcOrderAutoAssignController {
  /**
   * Service-to-service: notify nearby delivery partners (<= 3 km) that a new
   * Quick Commerce order is available to claim.
   */
  static async notifyAvailable(req: Request, res: Response): Promise<void> {
    const { orderId, orderNumber, sellerId, shopName, shopCoordinates, shopAddress, deliveryFee } = req.body;

    if (!orderId || !orderNumber) {
      res.status(400).json({ success: false, error: 'orderId and orderNumber are required' });
      return;
    }

    // Resolve shop coordinates if not provided directly
    let coordinates = shopCoordinates;
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      coordinates = await QcOrderAutoAssignService.resolveShopCoordinates(sellerId, shopName);
    }

    const result = await QcOrderAutoAssignService.notifyNearbyPartners({
      orderId,
      orderNumber,
      sellerId,
      shopName,
      shopCoordinates: coordinates,
      shopAddress,
      deliveryFee,
    });

    res.json({ success: true, data: result });
  }

  /**
   * Service-to-service: legacy auto-assign route now delegates to notifyAvailable
   * so orders remain open for manual application without auto-assignment.
   */
  static async autoAssign(req: Request, res: Response): Promise<void> {
    return QcOrderAutoAssignController.notifyAvailable(req, res);
  }
}
