import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { DispatchService } from '../services/DispatchService';

export class DispatchController {
  static async startBroadcast(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await DispatchService.startBroadcastForOrder(req.params.orderId);
    res.json({ success: true, data: result });
  }

  static async retryTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await DispatchService.startBroadcastForTask(req.params.taskId);
    res.json({ success: true, data: result });
  }

  static async expireOffers(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await DispatchService.expireOffers();
    res.json({ success: true, data: result });
  }
}
