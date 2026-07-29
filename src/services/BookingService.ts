import crypto from 'crypto';
import mongoose from 'mongoose';
import Task from '../models/Task';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import { CatalogService } from './CatalogService';
import { PaymentClient } from './PaymentClient';
import { computeLinePrice } from '../utils/bookingPricing';
import {
  normalizeBookNowTaskCategory,
  resolveBookNowCategoryLabel,
  resolveBookNowTaskCategory,
} from '../utils/bookNowClientCatalog';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { isHardcodedSupportedLocation } from '../constants/locations/isHardcodedSupportedLocation';
import {
  assertBookNowSlotAvailable,
  getOccupiedBookNowSlots,
  type BookNowTimeBucket,
} from '../utils/bookNowSlotAvailability';
import {
  assertPerItemScheduleFieldsComplete,
  collectDistinctBookNowSlotChecks,
  isCompleteResolvedBookNowSchedule,
  resolveBookNowLineDurationMinutes,
  resolveBookNowLineSchedule,
  scheduleFieldsFromResolved,
  usesPerItemBookNowScheduling,
  type BookNowScheduleInput,
  type ResolvedBookNowLineSchedule,
} from '../utils/bookNowScheduleResolution';
import { applyTaskAreaToLocation } from '../utils/resolveTaskArea';
import { schedulePostCreateNotifications } from './taskPostCreateNotifications';
import {
  assertHourlyInstantOperatingHours,
  assertHourlySingleVisitCheckout,
  isHourlyCatalogLineInput,
  isHourlyResolvedLine,
  parseBookingFulfillmentType,
} from '../utils/hourlyBookingGuards';
import { config } from '../config/env';
import type { BookingFulfillmentType } from '../models/BookingOrder';


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
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: BookNowTimeBucket;
  durationMinutes?: number;
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
  schedule?: ResolvedBookNowLineSchedule;
};

type PendingBookingLine = {
  skuId?: string;
  variantId?: string;
  addonIds: string[];
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
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: BookNowTimeBucket;
};

function pendingBookNowTaskId(orderId: string): string {
  return `booknow-pending-${orderId}`;
}

function serializePendingLine(line: ResolvedLine): PendingBookingLine {
  const schedule = scheduleFieldsFromResolved(line.schedule);
  return {
    packageSlug: line.packageSlug,
    categorySlug: line.categorySlug,
    categoryLabel: line.categoryLabel,
    taskCategory: line.taskCategory,
    pricingUnit: line.pricingUnit,
    quantity: line.quantity,
    lineTotal: line.lineTotal,
    durationMinutes: line.durationMinutes,
    title: line.title,
    snapshotName: line.snapshotName,
    skuId: line.skuId ? String(line.skuId) : undefined,
    variantId: line.variantId ? String(line.variantId) : undefined,
    addonIds: line.addonIds.map((id) => String(id)),
    scheduledDate: schedule?.scheduledDate,
    scheduledTimeStart: schedule?.scheduledTimeStart,
    scheduledTimeEnd: schedule?.scheduledTimeEnd,
    timeSlot: schedule?.timeSlot,
  };
}

function deserializePendingLine(line: PendingBookingLine): ResolvedLine {
  const schedule = resolveBookNowLineSchedule({
    lineSchedule: {
      scheduledDate: line.scheduledDate,
      scheduledTimeStart: line.scheduledTimeStart,
      scheduledTimeEnd: line.scheduledTimeEnd,
      timeSlot: line.timeSlot,
      durationMinutes: line.durationMinutes,
    },
    catalogDurationMinutes: line.durationMinutes,
  });

  return {
    packageSlug: line.packageSlug,
    categorySlug: line.categorySlug,
    categoryLabel: line.categoryLabel,
    taskCategory: line.taskCategory,
    pricingUnit: line.pricingUnit,
    quantity: line.quantity,
    lineTotal: line.lineTotal,
    durationMinutes: line.durationMinutes,
    title: line.title,
    snapshotName: line.snapshotName,
    schedule: schedule ?? undefined,
    skuId: line.skuId && mongoose.Types.ObjectId.isValid(line.skuId)
      ? new mongoose.Types.ObjectId(line.skuId)
      : undefined,
    variantId: line.variantId && mongoose.Types.ObjectId.isValid(line.variantId)
      ? new mongoose.Types.ObjectId(line.variantId)
      : undefined,
    addonIds: (line.addonIds || [])
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id)),
  };
}

function bookingItemScheduleFields(line: ResolvedLine) {
  if (!line.schedule) return {};
  return {
    scheduledDate: line.schedule.scheduledDateValue,
    scheduledTimeStart: line.schedule.scheduledTimeStart,
    scheduledTimeEnd: line.schedule.scheduledTimeEnd,
    timeSlot: line.schedule.timeSlot,
    durationMinutes: line.schedule.durationMinutes,
  };
}

function orderScheduleFromLine(line: ResolvedLine | undefined) {
  if (!line?.schedule) {
    return {
      scheduledDate: undefined,
      scheduledTimeStart: undefined,
      scheduledTimeEnd: undefined,
      timeSlot: undefined,
    };
  }

  return {
    scheduledDate: line.schedule.scheduledDateValue,
    scheduledTimeStart: line.schedule.scheduledTimeStart,
    scheduledTimeEnd: line.schedule.scheduledTimeEnd,
    timeSlot: line.schedule.timeSlot,
  };
}

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

    const durationMinutes = resolveBookNowLineDurationMinutes(60, line.durationMinutes);

    return {
      packageSlug: packageId,
      categorySlug: catalogId,
      categoryLabel: resolveBookNowCategoryLabel(catalogId),
      taskCategory: resolveBookNowTaskCategory(catalogId),
      pricingUnit: 'fixed',
      quantity,
      lineTotal,
      durationMinutes,
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

    const durationMinutes = resolveBookNowLineDurationMinutes(
      sku.durationMinutes + (variant?.durationDeltaMinutes || 0),
      line.durationMinutes,
    );
    const title = `${sku.name}${variant && !variant.isDefault ? ` — ${variant.name}` : ''}`;

    return {
      skuId: sku._id,
      variantId: variant?._id,
      addonIds: selectedAddons.map((a) => a._id),
      packageSlug: sku.slug,
      categorySlug: category?.slug || normalized.categorySlug!,
      categoryLabel: category?.name || resolveBookNowCategoryLabel(normalized.categorySlug!),
      taskCategory: normalizeBookNowTaskCategory(sku.taskCategory || 'cleaning'),
      pricingUnit: (sku.pricingUnit as 'fixed' | 'hourly') || 'fixed',
      quantity,
      lineTotal,
      durationMinutes,
      title,
      snapshotName: sku.name,
    };
  }

  private static async resolveLine(line: BookingLineInput): Promise<ResolvedLine> {
    // Hourly: always Mongo catalog price authority (never client name+price path).
    if (isHourlyCatalogLineInput(line)) {
      return this.resolveLineFromCatalog(line);
    }
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
    useExtraCoins?: boolean;
    requestedCoinDiscountRupees?: number;
    fulfillmentType?: BookingFulfillmentType | string;
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
      useExtraCoins,
      requestedCoinDiscountRupees,
    } = params;

    const fulfillmentType = parseBookingFulfillmentType(params.fulfillmentType);

    const serviceable = await CatalogService.isPinCodeServiceable(
      address.pinCode,
      address.city,
      customerUid,
      address.coordinates,
    );
    const hardcodedSupported = isHardcodedSupportedLocation({
      city: address.city,
      state: address.state,
      address: address.line1,
    });
    if (!serviceable && !hardcodedSupported) {
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

    const legacySchedule: BookNowScheduleInput = {
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
    };

    const looksHourlyInput = rawLines.some((line) => isHourlyCatalogLineInput(line));
    const isInstantHourly = looksHourlyInput && fulfillmentType === 'instant';

    if (isInstantHourly) {
      assertHourlyInstantOperatingHours({
        startHour: config.HOURLY_INSTANT_START_HOUR,
        endHour: config.HOURLY_INSTANT_END_HOUR,
      });
    }

    const perItemScheduling =
      !isInstantHourly && usesPerItemBookNowScheduling(rawLines, rawLines.length);

    if (perItemScheduling) {
      rawLines.forEach((line, index) => {
        try {
          assertPerItemScheduleFieldsComplete(line, index);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('INCOMPLETE_LINE_SCHEDULE:')) {
            const message = error.message.split(':').slice(2).join(':');
            throw new BadRequestError(message);
          }
          if (error instanceof Error && error.message.startsWith('INVALID_LINE_SCHEDULE_DATE:')) {
            const message = error.message.split(':').slice(2).join(':');
            throw new BadRequestError(message);
          }
          throw error;
        }
      });
    }

    // Scheduled Hourly: require a complete schedule (order-level or on the single line).
    if (looksHourlyInput && fulfillmentType === 'scheduled') {
      const line0 = rawLines[0];
      const hasLineSchedule = Boolean(
        line0?.scheduledDate && (line0.scheduledTimeStart || line0.timeSlot),
      );
      const hasOrderSchedule = Boolean(scheduledDate && (scheduledTimeStart || timeSlot));
      if (!hasLineSchedule && !hasOrderSchedule) {
        throw new BadRequestError(
          'Scheduled Hourly Helper requires a date and start time or time slot',
        );
      }
    }

    const resolvedLines = await Promise.all(rawLines.map((line) => this.resolveLine(line)));

    assertHourlySingleVisitCheckout({
      lines: resolvedLines,
      fulfillmentType: looksHourlyInput || resolvedLines.some(isHourlyResolvedLine)
        ? fulfillmentType
        : undefined,
    });

    const isHourlyOrder = resolvedLines.some(isHourlyResolvedLine);

    // After resolve: Instant Hourly still skips slot lead-time checks.
    const skipSlotChecks = isHourlyOrder && fulfillmentType === 'instant';

    const resolvedLinesWithSchedule = resolvedLines.map((line, index) => {
      if (skipSlotChecks) {
        return {
          ...line,
          schedule: undefined,
        };
      }

      const schedule = resolveBookNowLineSchedule({
        lineSchedule: rawLines[index],
        legacySchedule,
        catalogDurationMinutes: line.durationMinutes,
      });

      if (perItemScheduling && !isCompleteResolvedBookNowSchedule(schedule)) {
        throw new BadRequestError(
          `Each service must include a complete schedule (date and start time or time slot)`,
        );
      }

      return {
        ...line,
        durationMinutes: schedule?.durationMinutes ?? line.durationMinutes,
        schedule: schedule ?? undefined,
      };
    });

    if (!skipSlotChecks) {
      const slotChecks = collectDistinctBookNowSlotChecks(
        resolvedLinesWithSchedule.map((line) => line.schedule),
      );
      for (const slotCheck of slotChecks) {
        try {
          await assertBookNowSlotAvailable({
            date: slotCheck.date,
            city: address.city,
            scheduledTimeStart: slotCheck.scheduledTimeStart,
            timeSlot: slotCheck.timeSlot,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'SLOT_UNAVAILABLE') {
            throw new BadRequestError(
              'This time slot is no longer available. Please choose another slot.',
            );
          }
          if (error instanceof Error && error.message === 'SLOT_TOO_SOON') {
            throw new BadRequestError(
              'Book Now requires at least 3 hours notice. Please choose a later time slot.',
            );
          }
          throw error;
        }
      }
    }

    const pricingResult = await PaymentClient.calculateBookNowOrderTotals(
      resolvedLinesWithSchedule.map((line) => ({
        categorySlug: line.categorySlug,
        lineTotal: line.lineTotal,
      })),
    );

    if (!pricingResult.success || !pricingResult.totals) {
      throw new BadRequestError(
        pricingResult.error || 'Failed to calculate Book Now payment totals',
      );
    }

    const pricing = pricingResult.totals;
    const addonsTotal = pricing.addonsTotal ?? 0;

    const orderId = crypto.randomUUID();
    const primaryScheduleLine = resolvedLinesWithSchedule[0];
    const orderSchedule = orderScheduleFromLine(primaryScheduleLine);

    const order = await BookingOrder.create({
      orderId,
      customerUid,
      customerProfileId,
      status: 'awaiting_payment',
      address,
      ...(fulfillmentType ? { fulfillmentType } : {}),
      ...orderSchedule,
      subtotal: pricing.subtotal,
      addonsTotal,
      platformFee: pricing.platformFee,
      gst: pricing.gst,
      total: pricing.total,
      pendingLines: resolvedLinesWithSchedule.map(serializePendingLine),
      bookingNotes: notes?.trim() || undefined,
    });

    const createdItems: InstanceType<typeof BookingItem>[] = [];

    try {
      for (const line of resolvedLinesWithSchedule) {
        const item = await BookingItem.create({
          orderId,
          ...(line.skuId ? { skuId: line.skuId } : {}),
          ...(line.variantId ? { variantId: line.variantId } : {}),
          addonIds: line.addonIds,
          quantity: line.quantity,
          unitPrice: line.lineTotal / line.quantity,
          lineTotal: line.lineTotal,
          durationMinutes: line.durationMinutes,
          skuSnapshot: {
            name: line.snapshotName,
            slug: line.packageSlug,
            categorySlug: line.categorySlug,
          },
          ...bookingItemScheduleFields(line),
        });
        createdItems.push(item);
      }

      const primaryLine = resolvedLinesWithSchedule[0];
      const combinedTitle =
        resolvedLinesWithSchedule.length === 1
          ? primaryLine.title
          : `Book Now (${resolvedLinesWithSchedule.length} services)`;
      const placeholderTaskId = pendingBookNowTaskId(orderId);
      const applyCoins = useExtraCoins === true;
      const coinDiscountRequest = applyCoins
        ? Math.max(0, Math.floor(Number(requestedCoinDiscountRupees) || 0))
        : 0;

      const escrowResult = await PaymentClient.createBookingEscrow({
        taskId: placeholderTaskId,
        bookingOrderId: orderId,
        posterUid: customerUid,
        amount: pricing.total,
        taskAmount: pricing.subtotal,
        taskCategory: primaryLine.taskCategory,
        taskTitle: combinedTitle,
        metadata: {
          bookingOrderId: orderId,
          bookingMode: 'book_now',
          ...(fulfillmentType ? { fulfillmentType } : {}),
          ...(isHourlyOrder ? { hourlyHelper: true } : {}),
          itemCount: resolvedLinesWithSchedule.length,
          skuSlugs: resolvedLinesWithSchedule.map((l) => l.packageSlug),
          gstByCategory: pricing.categories,
          useExtraCoins: applyCoins && coinDiscountRequest > 0,
          requestedCoinDiscountRupees: coinDiscountRequest,
          amountBreakdown: {
            taskAmount: pricing.subtotal,
            gst: pricing.gst,
            platformFee: 0,
            extraCoinsDiscount: coinDiscountRequest,
            totalPaid: Math.max(0, pricing.total - coinDiscountRequest),
          },
          bookNowLineItems: resolvedLinesWithSchedule.map((line) => ({
            taskId: `${placeholderTaskId}:${line.packageSlug}`,
            taskTitle: line.title,
            lineAmountRupees: line.lineTotal,
            catalogId: line.categorySlug,
            categorySlug: line.categorySlug,
            pricingUnit: line.pricingUnit,
            scheduledDate: line.schedule?.scheduledDate,
            scheduledTimeStart: line.schedule?.scheduledTimeStart,
            scheduledTimeEnd: line.schedule?.scheduledTimeEnd,
            timeSlot: line.schedule?.timeSlot,
            durationMinutes: line.schedule?.durationMinutes ?? line.durationMinutes,
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

      logger.info('Book Now booking checkout created (tasks deferred until payment)', {
        orderId,
        customerUid,
        total: pricing.total,
        itemCount: resolvedLinesWithSchedule.length,
      });

      return {
        order,
        item: createdItems[0],
        items: createdItems,
        task: null,
        tasks: [],
        escrow: escrowResult.escrow,
        razorpayOrder: escrowResult.order,
      };
    } catch (error) {
      await BookingOrder.findByIdAndDelete(order._id);
      for (const item of createdItems) {
        await BookingItem.findByIdAndDelete(item._id);
      }
      throw error;
    }
  }

  private static async materializeBookingTasks(
    order: InstanceType<typeof BookingOrder>,
  ): Promise<InstanceType<typeof Task>[]> {
    const items = await BookingItem.find({ orderId: order.orderId }).sort({ createdAt: 1 });
    const existingTaskIds = items.map((item) => item.taskId).filter(Boolean);
    if (existingTaskIds.length > 0) {
      return Task.find({ _id: { $in: existingTaskIds } }).sort({ createdAt: 1 });
    }

    const rawPending = (order.pendingLines || []) as PendingBookingLine[];
    const lines = rawPending.map((line) => deserializePendingLine(line));
    if (!lines.length) {
      throw new BadRequestError('Booking has no services to post after payment');
    }

    const address = order.address;
    const createdTasks: InstanceType<typeof Task>[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const description =
        order.bookingNotes?.trim() ||
        `Book Now: ${line.title}. Address: ${address.line1}, ${address.city} ${address.pinCode}.`;

      const task = await Task.create({
        title: line.title,
        description,
        category: normalizeBookNowTaskCategory(line.taskCategory),
        categorySlug: line.categorySlug,
        categoryLabel: line.categoryLabel,
        subcategory: line.packageSlug,
        budget: { amount: line.lineTotal, currency: 'INR', type: line.pricingUnit },
        isNegotiable: false,
        location: applyTaskAreaToLocation({
          type: 'Point',
          coordinates: address.coordinates,
          address: [address.line1, address.line2].filter(Boolean).join(', '),
          city: address.city,
          state: address.state,
          pinCode: address.pinCode,
          country: 'IN',
        }),
        urgency: 'medium',
        priority: 'normal',
        status: 'open',
        requesterId: order.customerProfileId,
        scheduledDate: line.schedule?.scheduledDateValue ?? order.scheduledDate,
        scheduledTimeStart: line.schedule?.scheduledTimeStart ?? order.scheduledTimeStart,
        scheduledTimeEnd: line.schedule?.scheduledTimeEnd ?? order.scheduledTimeEnd,
        timeSlot: line.schedule?.timeSlot ?? order.timeSlot,
        flexibility: 'strict',
        estimatedDuration: line.schedule?.durationMinutes ?? line.durationMinutes,
        views: 0,
        isFeatured: false,
        currentRevisionRound: 0,
        negotiationStatus: 'closed',
        bookingSource: 'book_now',
        bookingOrderId: order.orderId,
        assignmentStatus: 'pending',
      });
      createdTasks.push(task);

      const item = items[index];
      if (item) {
        item.taskId = task._id;
        await item.save();
        await Task.findByIdAndUpdate(task._id, { bookingItemId: String(item._id) });
      } else {
        const createdItem = await BookingItem.create({
          orderId: order.orderId,
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
          ...bookingItemScheduleFields(line),
        });
        await Task.findByIdAndUpdate(task._id, { bookingItemId: String(createdItem._id) });
      }

      try {
        schedulePostCreateNotifications(task, {
          uid: order.customerUid,
          mappedCategory: line.categoryLabel,
          categorySlug: line.categorySlug,
          frontendCategory: line.categoryLabel,
        });
      } catch (err: any) {
        logger.error('Failed to trigger post-create notifications for Book Now task', {
          taskId: task._id,
          error: err.message,
        });
      }
    }

    order.pendingLines = undefined;
    await order.save();

    logger.info('Book Now tasks posted after payment', {
      orderId: order.orderId,
      taskIds: createdTasks.map((task) => task._id),
    });

    return createdTasks;
  }

  static async abandonUnpaidBooking(orderId: string, customerUid: string) {
    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');
    if (order.status !== 'awaiting_payment' || order.paidAt) {
      return { order, abandoned: false };
    }

    const items = await BookingItem.find({ orderId });
    for (const item of items) {
      if (item.taskId) {
        await Task.findByIdAndDelete(item.taskId);
      }
      await BookingItem.findByIdAndDelete(item._id);
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'Payment not completed';
    order.pendingLines = undefined;
    await order.save();

    logger.info('Abandoned unpaid Book Now checkout', { orderId, customerUid });
    return { order, abandoned: true };
  }

  static async getSlotAvailability(date: string, city: string) {
    const occupied = await getOccupiedBookNowSlots(date, city);
    return {
      date: String(date || '').trim(),
      city: String(city || '').trim(),
      ...occupied,
    };
  }

  /**
   * Client fallback when payment-service → task-service callback fails after Razorpay verify.
   * Idempotent — safe to call after every successful Book Now payment.
   */
  static async confirmPaymentForCustomer(orderId: string, customerUid: string) {
    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');

    if (order.status !== 'awaiting_payment') {
      if (order.pendingLines?.length) {
        await this.materializeBookingTasks(order);
      }
      return { success: true, alreadyConfirmed: true, order };
    }

    const escrowId = String(order.paymentEscrowId || '').trim();
    const razorpayOrderId = String(order.razorpayOrderId || '').trim();
    if (!escrowId || !razorpayOrderId) {
      throw new BadRequestError('Payment details are missing for this booking');
    }

    const escrow = await PaymentClient.getEscrowByEscrowId(escrowId);
    const escrowStatus = String(escrow?.status || '').toLowerCase();
    if (!escrow || !['held', 'completed', 'released'].includes(escrowStatus)) {
      throw new BadRequestError('Payment has not been captured yet. Please wait a moment and try again.');
    }

    return this.onPaymentCaptured({
      bookingOrderId: orderId,
      escrowId,
      razorpayOrderId,
      taskId: pendingBookNowTaskId(orderId),
    });
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
    const query = {
      customerUid,
      isDeletedByCustomer: { $ne: true },
    };
    const [orders, total] = await Promise.all([
      BookingOrder.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      BookingOrder.countDocuments(query),
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
      // Heal capture races: status may flip before Task.create succeeds (e.g. invalid category).
      const items = await BookingItem.find({ orderId: order.orderId }).select('taskId').lean();
      const missingTasks =
        Boolean(order.pendingLines?.length) || items.some((item) => !item.taskId);
      if (missingTasks) {
        await this.materializeBookingTasks(order);
      }
      let changed = false;
      if (!order.paymentEscrowId && params.escrowId) {
        order.paymentEscrowId = params.escrowId;
        changed = true;
      }
      if (!order.razorpayOrderId && params.razorpayOrderId) {
        order.razorpayOrderId = params.razorpayOrderId;
        changed = true;
      }
      if (!order.paidAt) {
        order.paidAt = new Date();
        changed = true;
      }
      if (changed) {
        await order.save();
      }

      // If already assigned, automatically link performer to escrow
      if (order.status === 'assigned') {
        const task = await Task.findById(params.taskId).lean();
        if (task && task.assigneeUid && params.escrowId) {
          try {
            const attach = await PaymentClient.attachPerformerToEscrow({
              escrowId: params.escrowId,
              performerUid: task.assigneeUid,
            });
            if (attach.success) {
              logger.info('Self-healed escrow attachment on post-payment capture', {
                orderId: order.orderId,
                escrowId: params.escrowId,
                performerUid: task.assigneeUid,
              });
            } else {
              logger.warn('Failed self-healed escrow attachment', {
                orderId: order.orderId,
                error: attach.error,
              });
            }
          } catch (err: any) {
            logger.error('Error during self-healed escrow attachment', {
              orderId: order.orderId,
              error: err.message,
            });
          }
        }
      }

      return { success: true, duplicate: true };
    }

    // Materialize tasks first — never leave order as `assigning` with no Task rows
    // (My Orders lists Tasks, not BookingOrders).
    order.paymentEscrowId = params.escrowId;
    order.razorpayOrderId = params.razorpayOrderId;
    order.paidAt = new Date();
    const tasks = await this.materializeBookingTasks(order);

    order.status = 'assigning';
    await order.save();

    const primaryTaskId = tasks[0] ? String(tasks[0]._id) : params.taskId;

    logger.info('Book Now order marked paid/assigning', {
      orderId: order.orderId,
      taskId: primaryTaskId,
      taskCount: tasks.length,
    });

    return { success: true, order, tasks };
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
        const refundResult = await PaymentClient.cancelPaymentForTask({
          taskId: String(task._id),
          bookingOrderId: orderId,
          escrowId: order.paymentEscrowId || undefined,
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
        if (!refundResult.success) {
          throw new BadRequestError(refundResult.error || 'Refund failed for this service');
        }
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
        const refundResult = await PaymentClient.cancelPaymentForTask({
          taskId: String(task._id),
          bookingOrderId: orderId,
          escrowId: order.paymentEscrowId || undefined,
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
        if (!refundResult.success) {
          throw new BadRequestError(refundResult.error || 'Refund failed for this booking');
        }
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
