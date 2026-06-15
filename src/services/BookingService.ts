import crypto from 'crypto';
import mongoose from 'mongoose';
import Task from '../models/Task';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import { CatalogService } from './CatalogService';
import { PaymentClient } from './PaymentClient';
import { computeBookingTotals, computeLinePrice } from '../utils/bookingPricing';
import {
  resolveBookNowCategoryLabel,
  resolveBookNowTaskCategory,
} from '../utils/bookNowClientCatalog';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';

type BookingAddress = {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  pinCode: string;
  coordinates?: [number, number];
};

export type BookingLineInput = {
  skuSlug?: string;
  categorySlug?: string;
  catalogId?: string;
  packageId?: string;
  variantSlug?: string;
  addonSlugs?: string[];
  quantity?: number;
  bathroomCount?: number;
  /** From mobile app package catalog — preferred over MongoDB SKU lookup */
  name?: string;
  unitPrice?: number;
  lineTotal?: number;
  taskDescription?: string;
};

type ResolvedLine = {
  skuId?: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  addonIds: mongoose.Types.ObjectId[];
  packageSlug: string;
  categorySlug: string;
  categoryLabel: string;
  taskCategory: string;
  pricingUnit: 'fixed' | 'hourly';
  quantity: number;
  lineTotal: number;
  durationMinutes: number;
  title: string;
  snapshotName: string;
};

export class BookingService {
  /** Helper on site — highest Book Now cancellation tier. */
  static isBookNowPartnerReached(task: { status?: string }): boolean {
    const status = String(task.status || '').toLowerCase();
    return status === 'started' || status === 'in_progress';
  }

  private static normalizeLineInput(line: BookingLineInput): BookingLineInput {
    const categorySlug = line.categorySlug || line.catalogId;
    const skuSlug = line.skuSlug || line.packageId;
    if (!skuSlug) {
      throw new BadRequestError('Each cart item must include skuSlug or packageId');
    }

    let variantSlug = line.variantSlug;
    if (!variantSlug && line.bathroomCount && line.bathroomCount >= 1 && line.bathroomCount <= 5) {
      variantSlug = `bathrooms-${line.bathroomCount}`;
    }

    return {
      ...line,
      categorySlug,
      skuSlug,
      variantSlug,
      quantity: line.quantity && line.quantity > 0 ? line.quantity : 1,
    };
  }

  private static hasClientCatalogLine(line: BookingLineInput): boolean {
    const name = String(line.name || '').trim();
    const hasPrice = line.lineTotal != null || line.unitPrice != null;
    return Boolean(name && hasPrice);
  }

  /** Use package name + price from the mobile app (source of truth). */
  private static resolveLineFromClient(line: BookingLineInput): ResolvedLine {
    const normalized = this.normalizeLineInput(line);
    const catalogId = normalized.categorySlug!;
    const packageId = normalized.skuSlug!;
    const name = String(line.name || '').trim();
    const quantity = normalized.quantity || 1;

    let lineTotal: number;
    if (line.lineTotal != null && Number.isFinite(line.lineTotal)) {
      lineTotal = Math.round(line.lineTotal * 100) / 100;
    } else if (line.unitPrice != null && Number.isFinite(line.unitPrice)) {
      lineTotal = Math.round(line.unitPrice * quantity * 100) / 100;
    } else {
      throw new BadRequestError(`Price is required for ${name || packageId}`);
    }

    if (lineTotal <= 0) {
      throw new BadRequestError(`Invalid price for ${name}`);
    }

    return {
      packageSlug: packageId,
      categorySlug: catalogId,
      categoryLabel: resolveBookNowCategoryLabel(catalogId),
      taskCategory: resolveBookNowTaskCategory(catalogId),
      pricingUnit: 'fixed',
      quantity,
      lineTotal,
      durationMinutes: 60,
      title: name,
      snapshotName: name,
      addonIds: [],
    };
  }

  /** Legacy path: resolve from MongoDB catalog (e.g. API-only checkout). */
  private static async resolveLineFromCatalog(line: BookingLineInput): Promise<ResolvedLine> {
    const normalized = this.normalizeLineInput(line);
    const { sku, variants, addons, category } = await CatalogService.getSkuDetail(
      normalized.skuSlug!,
      normalized.categorySlug,
    );

    let variant = variants.find((v) => v.isDefault) || variants[0] || null;
    if (normalized.variantSlug) {
      const picked = variants.find((v) => v.slug === normalized.variantSlug);
      if (!picked) throw new BadRequestError(`Invalid variant for ${sku.name}`);
      variant = picked;
    }

    const addonSlugs = normalized.addonSlugs || [];
    const selectedAddons = addons.filter((a) => addonSlugs.includes(a.slug));
    if (selectedAddons.length !== addonSlugs.length) {
      throw new BadRequestError('One or more add-ons are invalid');
    }

    const quantity = normalized.quantity || 1;
    const lineTotal = computeLinePrice(
      sku.basePrice,
      variant?.priceDelta || 0,
      selectedAddons.map((a) => a.price),
      quantity,
    );

    const durationMinutes = sku.durationMinutes + (variant?.durationDeltaMinutes || 0);
    const title = `${sku.name}${variant && !variant.isDefault ? ` — ${variant.name}` : ''}`;

    return {
      skuId: sku._id,
      variantId: variant?._id,
      addonIds: selectedAddons.map((a) => a._id),
      packageSlug: sku.slug,
      categorySlug: category?.slug || normalized.categorySlug!,
      categoryLabel: category?.name || resolveBookNowCategoryLabel(normalized.categorySlug!),
      taskCategory: sku.taskCategory || 'cleaning',
      pricingUnit: (sku.pricingUnit as 'fixed' | 'hourly') || 'fixed',
      quantity,
      lineTotal,
      durationMinutes,
      title,
      snapshotName: sku.name,
    };
  }

  private static async resolveLine(line: BookingLineInput): Promise<ResolvedLine> {
    if (this.hasClientCatalogLine(line)) {
      return this.resolveLineFromClient(line);
    }
    return this.resolveLineFromCatalog(line);
  }

  static async createBooking(params: {
    customerUid: string;
    customerProfileId: mongoose.Types.ObjectId;
    skuSlug?: string;
    categorySlug?: string;
    variantSlug?: string;
    addonSlugs?: string[];
    quantity?: number;
    items?: BookingLineInput[];
    address: BookingAddress;
    scheduledDate?: string;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    timeSlot?: 'morning' | 'midday' | 'afternoon' | 'evening';
    notes?: string;
    name?: string;
    unitPrice?: number;
    lineTotal?: number;
  }) {
    const {
      customerUid,
      customerProfileId,
      address,
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
      notes,
      name,
      unitPrice,
      lineTotal,
    } = params;

    const serviceable = await CatalogService.isPinCodeServiceable(
      address.pinCode,
      address.city,
      customerUid,
      address.coordinates,
    );
    if (!serviceable) {
      throw new BadRequestError('Service is not available in this area yet');
    }

    const rawLines: BookingLineInput[] =
      params.items && params.items.length > 0
        ? params.items
        : [
            {
              skuSlug: params.skuSlug,
              categorySlug: params.categorySlug,
              variantSlug: params.variantSlug,
              addonSlugs: params.addonSlugs,
              quantity: params.quantity,
              name,
              unitPrice,
              lineTotal,
            },
          ];

    if (!rawLines[0]?.skuSlug && !rawLines[0]?.packageId) {
      throw new BadRequestError('At least one service item is required');
    }

    const resolvedLines = await Promise.all(rawLines.map((line) => this.resolveLine(line)));
    const subtotal = resolvedLines.reduce((sum, line) => sum + line.lineTotal, 0);
    const addonsTotal = 0;
    const pricing = computeBookingTotals(subtotal);

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
      addonsTotal,
      platformFee: pricing.platformFee,
      gst: pricing.gst,
      total: pricing.total,
    });

    const createdTasks: InstanceType<typeof Task>[] = [];
    const createdItems: InstanceType<typeof BookingItem>[] = [];

    try {
      for (const line of resolvedLines) {
        const description =
          notes?.trim() ||
          `Book Now: ${line.title}. Address: ${address.line1}, ${address.city} ${address.pinCode}.`;

        const task = await Task.create({
          title: line.title,
          description,
          category: line.taskCategory as any,
          categorySlug: line.categorySlug,
          categoryLabel: line.categoryLabel,
          subcategory: line.packageSlug,
          budget: { amount: line.lineTotal, currency: 'INR', type: line.pricingUnit },
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
          estimatedDuration: line.durationMinutes,
          views: 0,
          isFeatured: false,
          currentRevisionRound: 0,
          negotiationStatus: 'closed',
          bookingSource: 'book_now',
          bookingOrderId: orderId,
          assignmentStatus: 'pending',
        });
        createdTasks.push(task);

        const item = await BookingItem.create({
          orderId,
          ...(line.skuId ? { skuId: line.skuId } : {}),
          ...(line.variantId ? { variantId: line.variantId } : {}),
          addonIds: line.addonIds,
          quantity: line.quantity,
          unitPrice: line.lineTotal / line.quantity,
          lineTotal: line.lineTotal,
          taskId: task._id,
          skuSnapshot: {
            name: line.snapshotName,
            slug: line.packageSlug,
            categorySlug: line.categorySlug,
          },
        });
        createdItems.push(item);

        await Task.findByIdAndUpdate(task._id, { bookingItemId: String(item._id) });
      }

      const primaryTask = createdTasks[0];
      const primaryLine = resolvedLines[0];
      const combinedTitle =
        resolvedLines.length === 1
          ? primaryLine.title
          : `Book Now (${resolvedLines.length} services)`;

      const escrowResult = await PaymentClient.createBookingEscrow({
        taskId: String(primaryTask._id),
        bookingOrderId: orderId,
        posterUid: customerUid,
        amount: pricing.total,
        taskAmount: subtotal,
        taskCategory: primaryLine.taskCategory,
        taskTitle: combinedTitle,
        metadata: {
          bookingOrderId: orderId,
          bookingMode: 'book_now',
          itemCount: resolvedLines.length,
          skuSlugs: resolvedLines.map((l) => l.packageSlug),
          bookNowLineItems: createdTasks.map((task, index) => ({
            taskId: String(task._id),
            taskTitle: resolvedLines[index]?.title || task.title,
            lineAmountRupees: resolvedLines[index]?.lineTotal,
            catalogId: resolvedLines[index]?.categorySlug,
            categorySlug: resolvedLines[index]?.categorySlug,
          })),
        },
      });

      if (!escrowResult.success || !escrowResult.order?.id) {
        throw new BadRequestError(escrowResult.error || 'Failed to create payment');
      }

      if (!escrowResult.escrow?.escrowId) {
        throw new BadRequestError(
          'Payment escrow was not saved. Please retry — ensure the payment service is connected to Postgres.',
        );
      }

      order.paymentEscrowId = escrowResult.escrow.escrowId;
      order.razorpayOrderId = escrowResult.order.id || escrowResult.escrow?.razorpayOrderId;
      await order.save();

      logger.info('Book Now booking created', {
        orderId,
        taskIds: createdTasks.map((t) => t._id),
        customerUid,
        total: pricing.total,
        itemCount: resolvedLines.length,
      });

      return {
        order,
        item: createdItems[0],
        items: createdItems,
        task: primaryTask,
        tasks: createdTasks,
        escrow: escrowResult.escrow,
        razorpayOrder: escrowResult.order,
      };
    } catch (error) {
      await BookingOrder.findByIdAndDelete(order._id);
      for (const item of createdItems) {
        await BookingItem.findByIdAndDelete(item._id);
      }
      for (const task of createdTasks) {
        await Task.findByIdAndDelete(task._id);
      }
      throw error;
    }
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

  static async findOrderIdForTask(taskId: string, customerUid: string): Promise<string | null> {
    if (!mongoose.Types.ObjectId.isValid(taskId)) return null;

    const task = await Task.findById(taskId).select('bookingOrderId requesterId').lean();
    if (task?.bookingOrderId) {
      const owned = await BookingOrder.findOne({
        orderId: task.bookingOrderId,
        customerUid,
      })
        .select('orderId')
        .lean();
      if (owned) return task.bookingOrderId;
    }

    const item = await BookingItem.findOne({
      taskId: new mongoose.Types.ObjectId(taskId),
    })
      .select('orderId')
      .lean();
    if (!item?.orderId) return null;

    const order = await BookingOrder.findOne({ orderId: item.orderId, customerUid })
      .select('orderId')
      .lean();
    return order ? item.orderId : null;
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

  static async cancelBookingItem(
    orderId: string,
    taskId: string,
    customerUid: string,
    reason?: string,
  ) {
    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');
    if (['cancelled', 'refunded'].includes(order.status)) {
      throw new BadRequestError(`Cannot cancel booking in status ${order.status}`);
    }

    const items = await BookingItem.find({ orderId });
    const item = items.find((i) => String(i.taskId) === taskId);
    if (!item) throw new NotFoundError('Service not found in this booking');
    if (item.status === 'cancelled') {
      throw new BadRequestError('This service is already cancelled');
    }

    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (task.status !== 'open') {
      throw new BadRequestError('This service can no longer be cancelled');
    }

    const remainingActive = items.filter(
      (i) => i.status !== 'cancelled' && String(i.taskId) !== taskId,
    );
    const isLastActiveItem = remainingActive.length === 0;
    const isMultiItem = items.length > 1;

    const taskStartIso = (task.scheduledDate || task.createdAt).toISOString();
    const assignedAtIso = task.assignedAt
      ? new Date(task.assignedAt).toISOString()
      : null;
    const catalogId = item.skuSnapshot?.categorySlug || task.categorySlug;
    const partnerReachedLocation = BookingService.isBookNowPartnerReached(task);

    if (order.paidAt) {
      if (isMultiItem) {
        const refundResult = await PaymentClient.partialRefundBookNowLineItem({
          bookingOrderId: orderId,
          taskId: String(taskId),
          lineAmountRupees: item.lineTotal,
          taskStartDate: taskStartIso,
          assignedAt: assignedAtIso,
          reason: reason || 'Book Now service cancelled by customer',
          userId: customerUid,
          taskTitle: task.title,
          isLastActiveItem,
          catalogId,
          partnerReachedLocation,
        });
        if (!refundResult.success) {
          throw new BadRequestError(refundResult.error || 'Refund failed for this service');
        }
      } else {
        await PaymentClient.cancelPaymentForTask({
          taskId: String(task._id),
          reason: reason || 'Book Now cancelled by customer',
          userId: customerUid,
          cancelledBy: 'poster',
          taskStartDate: taskStartIso,
          assignedAt: assignedAtIso,
          feeBaseAmount: item.lineTotal,
          taskTitle: task.title,
          catalogId,
          partnerReachedLocation,
        });
      }
    }

    task.status = 'cancelled';
    task.cancelledAt = new Date();
    task.cancellationReason = reason || 'Cancelled by customer';
    await task.save();

    item.status = 'cancelled';
    item.cancelledAt = new Date();
    item.cancellationReason = reason || 'Cancelled by customer';
    await item.save();

    if (isLastActiveItem) {
      order.status = order.paidAt ? 'refunded' : 'cancelled';
      order.cancelledAt = new Date();
      order.cancellationReason = reason;
    }

    await order.save();

    return { order, item, remainingItems: remainingActive };
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
    let refundInitiated = false;

    for (const taskId of taskIds) {
      const task = await Task.findById(taskId);
      if (!task) continue;
      if (task.status !== 'open' && task.status !== 'assigned') {
        throw new BadRequestError('Task already in progress');
      }

      if (order.paidAt && task.status === 'open' && !refundInitiated) {
        const firstItem = items.find((i) => String(i.taskId) === String(task._id)) || items[0];
        await PaymentClient.cancelPaymentForTask({
          taskId: String(task._id),
          reason: reason || 'Book Now cancelled before assignment',
          userId: customerUid,
          cancelledBy: 'poster',
          taskStartDate: (task.scheduledDate || task.createdAt).toISOString(),
          assignedAt: null,
          feeBaseAmount: order.subtotal,
          taskTitle: task.title,
          catalogId: firstItem?.skuSnapshot?.categorySlug || task.categorySlug,
          partnerReachedLocation: BookingService.isBookNowPartnerReached(task),
        });
        refundInitiated = true;
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
