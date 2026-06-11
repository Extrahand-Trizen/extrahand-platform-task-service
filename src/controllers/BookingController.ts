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
      items,
      address,
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      notes,
      name,
      unitPrice,
      lineTotal,
    } = req.body;

    const hasItems = Array.isArray(items) && items.length > 0;
    if ((!skuSlug && !hasItems) || !address?.line1 || !address?.city || !address?.pinCode) {
      throw new BadRequestError('Service item(s) and full address are required');
    }

    const result = await BookingService.createBooking({
      customerUid: user.uid,
      customerProfileId: user.profileId,
      skuSlug,
      categorySlug,
      variantSlug,
      addonSlugs,
      quantity,
      items,
      address,
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      notes,
      name,
      unitPrice,
      lineTotal,
    });

    res.status(201).json({
      success: true,
      data: {
        order: result.order,
        item: result.item,
        items: result.items,
        task: result.task,
        tasks: result.tasks,
        escrow: result.escrow,
        razorpayOrder: result.razorpayOrder,
      },
    });
  }

  static async getOrderIdForTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const orderId = await BookingService.findOrderIdForTask(req.params.taskId, user.uid);
    if (!orderId) {
      res.status(404).json({ success: false, error: 'Booking not found for this work' });
      return;
    }
    res.json({ success: true, data: { orderId } });
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

  static async cancelOrderItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const taskId = String(req.body?.taskId || '').trim();
    if (!taskId) {
      throw new BadRequestError('taskId is required');
    }
    const data = await BookingService.cancelBookingItem(
      req.params.orderId,
      taskId,
      user.uid,
      req.body?.reason,
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
