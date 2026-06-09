import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { AuthenticatedRequest } from '../types';
import { BadRequestError } from '../errors/AppError';

export class BookingController {
  static async createBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid || !user.profileId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const {
      skuSlug,
      categorySlug,
      variantSlug,
      addonSlugs,
      quantity,
      address,
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      notes,
    } = req.body;

    if (!skuSlug || !address?.line1 || !address?.city || !address?.pinCode) {
      throw new BadRequestError('skuSlug and full address are required');
    }

    const result = await BookingService.createBooking({
      customerUid: user.uid,
      customerProfileId: user.profileId,
      skuSlug,
      categorySlug,
      variantSlug,
      addonSlugs,
      quantity,
      address,
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      notes,
    });

    res.status(201).json({
      success: true,
      data: {
        order: result.order,
        item: result.item,
        task: result.task,
        escrow: result.escrow,
        razorpayOrder: result.razorpayOrder,
      },
    });
  }

  static async getOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const data = await BookingService.getOrderForCustomer(req.params.orderId, user.uid);
    res.json({ success: true, data });
  }

  static async listMyOrders(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const limit = Number(req.query.limit) || 20;
    const page = Number(req.query.page) || 1;
    const data = await BookingService.listOrdersForCustomer(user.uid, limit, page);
    res.json({ success: true, data });
  }

  static async cancelOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const data = await BookingService.cancelBooking(
      req.params.orderId,
      user.uid,
      req.body?.reason
    );
    res.json({ success: true, data });
  }

  /** Service-to-service: payment-service webhook callback after capture */
  static async paymentCaptured(req: Request, res: Response): Promise<void> {
    const { bookingOrderId, escrowId, razorpayOrderId, taskId } = req.body;
    if (!bookingOrderId || !escrowId || !razorpayOrderId || !taskId) {
      throw new BadRequestError('bookingOrderId, escrowId, razorpayOrderId, taskId required');
    }
    const result = await BookingService.onPaymentCaptured({
      bookingOrderId,
      escrowId,
      razorpayOrderId,
      taskId,
    });
    res.json({ success: true, data: result });
  }
}
