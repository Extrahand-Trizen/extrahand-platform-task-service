import crypto from 'crypto';
import mongoose from 'mongoose';
import Task from '../models/Task';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import { CatalogService } from './CatalogService';
import { PaymentClient } from './PaymentClient';
import { computeBookingTotals, computeLinePrice } from '../utils/bookingPricing';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';

export class BookingService {
  static async createBooking(params: {
    customerUid: string;
    customerProfileId: mongoose.Types.ObjectId;
    skuSlug: string;
    categorySlug?: string;
    variantSlug?: string;
    addonSlugs?: string[];
    quantity?: number;
    address: {
      label?: string;
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      pinCode: string;
      coordinates?: [number, number];
    };
    scheduledDate?: string;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    timeSlot?: 'morning' | 'midday' | 'afternoon' | 'evening';
    notes?: string;
  }) {
    const {
      customerUid,
      customerProfileId,
      skuSlug,
      categorySlug,
      variantSlug,
      addonSlugs = [],
      quantity = 1,
      address,
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      notes,
    } = params;

    const serviceable = await CatalogService.isPinCodeServiceable(address.pinCode, address.city);
    if (!serviceable) {
      throw new BadRequestError('Service is not available in this area yet');
    }

    const { sku, variants, addons, category } = await CatalogService.getSkuDetail(skuSlug, categorySlug);

    let variant = variants.find((v) => v.isDefault) || variants[0];
    if (variantSlug) {
      const picked = variants.find((v) => v.slug === variantSlug);
      if (!picked) throw new BadRequestError('Invalid variant');
      variant = picked;
    }

    const selectedAddons = addons.filter((a) => addonSlugs.includes(a.slug));
    if (selectedAddons.length !== addonSlugs.length) {
      throw new BadRequestError('One or more add-ons are invalid');
    }

    const lineTotal = computeLinePrice(
      sku.basePrice,
      variant?.priceDelta || 0,
      selectedAddons.map((a) => a.price),
      quantity
    );
    const pricing = computeBookingTotals(lineTotal);

    const orderId = crypto.randomUUID();
    const order = await BookingOrder.create({
      orderId,
      customerUid,
      customerProfileId,
      status: 'awaiting_payment',
      address,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      subtotal: pricing.subtotal,
      addonsTotal: selectedAddons.reduce((s, a) => s + a.price, 0),
      platformFee: pricing.platformFee,
      gst: pricing.gst,
      total: pricing.total,
    });

    const durationMinutes =
      sku.durationMinutes + (variant?.durationDeltaMinutes || 0);

    const title = `${sku.name}${variant && !variant.isDefault ? ` — ${variant.name}` : ''}`;
    const description =
      notes?.trim() ||
      `Book Now: ${sku.name}. Address: ${address.line1}, ${address.city} ${address.pinCode}.`;

    const task = await Task.create({
      title,
      description,
      category: (sku.taskCategory as any) || 'cleaning',
      categorySlug: category?.slug,
      categoryLabel: category?.name,
      subcategory: sku.slug,
      budget: { amount: lineTotal, currency: 'INR', type: sku.pricingUnit },
      isNegotiable: false,
      location: {
        type: 'Point',
        coordinates: address.coordinates,
        address: [address.line1, address.line2].filter(Boolean).join(', '),
        city: address.city,
        state: address.state,
        pinCode: address.pinCode,
        country: 'IN',
      },
      urgency: 'medium',
      priority: 'normal',
      status: 'open',
      requesterId: customerProfileId,
      scheduledDate: order.scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      flexibility: 'strict',
      estimatedDuration: durationMinutes,
      views: 0,
      isFeatured: false,
      currentRevisionRound: 0,
      negotiationStatus: 'closed',
      bookingSource: 'book_now',
      bookingOrderId: orderId,
      assignmentStatus: 'pending',
    });

    const item = await BookingItem.create({
      orderId,
      skuId: sku._id,
      variantId: variant?._id,
      addonIds: selectedAddons.map((a) => a._id),
      quantity,
      unitPrice: lineTotal / quantity,
      lineTotal,
      taskId: task._id,
      skuSnapshot: {
        name: sku.name,
        slug: sku.slug,
        categorySlug: category?.slug,
      },
    });

    await Task.findByIdAndUpdate(task._id, { bookingItemId: String(item._id) });

    const escrowResult = await PaymentClient.createBookingEscrow({
      taskId: String(task._id),
      bookingOrderId: orderId,
      posterUid: customerUid,
      amount: pricing.total,
      taskAmount: lineTotal,
      taskCategory: sku.taskCategory,
      taskTitle: title,
      metadata: {
        bookingOrderId: orderId,
        skuSlug: sku.slug,
      },
    });

    if (!escrowResult.success) {
      await BookingOrder.findByIdAndDelete(order._id);
      await BookingItem.findByIdAndDelete(item._id);
      await Task.findByIdAndDelete(task._id);
      throw new BadRequestError(escrowResult.error || 'Failed to create payment');
    }

    order.paymentEscrowId = escrowResult.escrow?.escrowId;
    order.razorpayOrderId = escrowResult.order?.id || escrowResult.escrow?.razorpayOrderId;
    await order.save();

    logger.info('Book Now booking created', {
      orderId,
      taskId: task._id,
      customerUid,
      total: pricing.total,
    });

    return {
      order,
      item,
      task,
      escrow: escrowResult.escrow,
      razorpayOrder: escrowResult.order,
    };
  }

  static async getOrderForCustomer(orderId: string, customerUid: string) {
    const order = await BookingOrder.findOne({ orderId }).lean();
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');

    const items = await BookingItem.find({ orderId }).lean();
    const taskIds = items.map((i) => i.taskId).filter(Boolean);
    const tasks = await Task.find({ _id: { $in: taskIds } }).lean();

    return { order, items, tasks };
  }

  static async listOrdersForCustomer(customerUid: string, limit = 20, page = 1) {
    const skip = (Math.max(page, 1) - 1) * limit;
    const [orders, total] = await Promise.all([
      BookingOrder.find({ customerUid }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      BookingOrder.countDocuments({ customerUid }),
    ]);
    return {
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  static async onPaymentCaptured(params: {
    bookingOrderId: string;
    escrowId: string;
    razorpayOrderId: string;
    taskId: string;
  }) {
    const order = await BookingOrder.findOne({ orderId: params.bookingOrderId });
    if (!order) {
      logger.warn('Payment captured for unknown booking', params);
      return { success: false, error: 'Booking not found' };
    }

    if (order.status === 'paid' || order.status === 'assigning' || order.status === 'assigned') {
      return { success: true, duplicate: true };
    }

    order.status = 'assigning';
    order.paymentEscrowId = params.escrowId;
    order.razorpayOrderId = params.razorpayOrderId;
    order.paidAt = new Date();
    await order.save();

    logger.info('Book Now order marked paid/assigning', {
      orderId: order.orderId,
      taskId: params.taskId,
    });

    return { success: true, order };
  }

  static async cancelBooking(orderId: string, customerUid: string, reason?: string) {
    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');
    if (['cancelled', 'refunded', 'assigned'].includes(order.status)) {
      throw new BadRequestError(`Cannot cancel booking in status ${order.status}`);
    }

    const items = await BookingItem.find({ orderId });
    const taskIds = items.map((i) => i.taskId).filter(Boolean);

    for (const taskId of taskIds) {
      const task = await Task.findById(taskId);
      if (!task) continue;
      if (task.status !== 'open' && task.status !== 'assigned') {
        throw new BadRequestError('Task already in progress');
      }

      if (order.paidAt && task.status === 'open') {
        await PaymentClient.cancelPaymentForTask({
          taskId: String(task._id),
          reason: reason || 'Book Now cancelled before assignment',
          userId: customerUid,
          cancelledBy: 'poster',
          taskStartDate: (task.scheduledDate || task.createdAt).toISOString(),
          assignedAt: null,
          feeBaseAmount: task.budget?.amount,
          taskTitle: task.title,
        });
      }

      task.status = 'cancelled';
      task.cancelledAt = new Date();
      task.cancellationReason = reason || 'Cancelled by customer';
      await task.save();
    }

    order.status = order.paidAt ? 'refunded' : 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = reason;
    await order.save();

    return { order, items };
  }
}
