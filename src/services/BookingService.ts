import crypto from 'crypto';
import mongoose from 'mongoose';
import Task, { type ITask } from '../models/Task';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import ServiceQuotation from '../models/ServiceQuotation';
import { CatalogService } from './CatalogService';
import { PaymentClient } from './PaymentClient';
import { computeBookingTotals, computeLinePrice } from '../utils/bookingPricing';
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
  deriveBookNowTimeSlot,
  getOccupiedBookNowSlots,
  isBookNowSlotWithinLeadTime,
  normalizeBookNowSlotLabel,
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
import { BookNowAutoAssignService } from './BookNowAutoAssignService';
import {
  assertHourlyInstantOperatingHours,
  assertHourlySingleVisitCheckout,
  isHourlyCatalogLineInput,
  isHourlyResolvedLine,
  parseBookingFulfillmentType,
} from '../utils/hourlyBookingGuards';
import { assertBookNowFixedPriceMinimumCheckout } from '../utils/bookNowFixedPriceMinimum';
import { BookNowCatalogBootstrap } from './BookNowCatalogBootstrap';
import { abandonUnpaidBookingOrder } from './bookingAbandonUnpaid';
import { cancelHourlyBooking } from './cancellation/cancellationOrchestrator';
import { evaluateProjectCancellation } from './cancellation/projectCancellationPolicy';
import {
  applyBookingFlowDefaults,
  buildConsultationTaskState,
  isConsultationBookingKind,
  resolveBookingFlowDefaults,
  type BookingKind,
  type ConsultationBookingMeta,
  type ServiceFlowType,
} from '../utils/consultationBooking';
import { resolveBookNowServiceFlowConfig } from '../utils/bookNowServiceFlowConfig';
import {
  buildConsultationProjectPlan,
  buildConsultationTaskProjectTransitionPatch,
} from '../utils/consultationProject';
import {
  isHourlyBookingFromHints,
} from './cancellation/cancellationContext';
import { config } from '../config/env';
import type { BookingFulfillmentType } from '../models/BookingOrder';
import {
  isHelperAssignedOnTask,
  type HourlyCancellationOrchestratorResult,
} from './cancellation/cancellationTypes';
import {
  evaluateBookingLineReschedulePolicy,
  resolveReschedulePartnerState,
  resolveScheduledAt,
  type ReschedulePartnerState,
} from '../utils/reschedulePolicy';
import { ProfileUtils } from '../utils/ProfileUtils';


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
  images?: string[];
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: BookNowTimeBucket;
  durationMinutes?: number;
  serviceFlowType?: ServiceFlowType;
  bookingKind?: BookingKind;
  serviceType?: string;
  consultationMeta?: ConsultationBookingMeta;
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
  images?: string[];
  schedule?: ResolvedBookNowLineSchedule;
  serviceFlowType?: ServiceFlowType;
  bookingKind?: BookingKind;
  serviceType?: string;
  consultationMeta?: ConsultationBookingMeta;
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
  images?: string[];
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: BookNowTimeBucket;
  serviceFlowType?: ServiceFlowType;
  bookingKind?: BookingKind;
  serviceType?: string;
  consultationMeta?: ConsultationBookingMeta;
};

const MAX_ONE_TIME_RESCHEDULES = 2;
const CONSULTATION_PROJECT_TAX_RATE = Number(process.env.CONSULTATION_PROJECT_TAX_RATE || '0');
const RESCHEDULE_SLOT_STARTS = [
  '8:00 AM',
  '8:30 AM',
  '9:00 AM',
  '9:30 AM',
  '10:00 AM',
  '10:30 AM',
  '11:00 AM',
  '11:30 AM',
  '12:00 PM',
  '12:30 PM',
  '1:00 PM',
  '1:30 PM',
  '2:00 PM',
  '2:30 PM',
  '3:00 PM',
  '3:30 PM',
  '4:00 PM',
  '4:30 PM',
  '5:00 PM',
  '5:30 PM',
  '6:00 PM',
  '6:30 PM',
  '7:00 PM',
  '7:30 PM',
  '8:00 PM',
];

function partnerStateSeverity(state: ReschedulePartnerState): number {
  switch (state) {
    case 'started':
      return 5;
    case 'arrived':
      return 4;
    case 'on_the_way':
      return 3;
    case 'assigned':
      return 2;
    default:
      return 1;
  }
}

function parseCalendarDate(date: string): Date {
  const trimmed = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestError('scheduledDate must be YYYY-MM-DD');
  }
  return new Date(`${trimmed}T00:00:00.000+05:30`);
}

function parseSlotMinutes(slot: string): number | null {
  const match = String(slot || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function minutesToSlot(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function defaultSlotEnd(start: string): string {
  const minutes = parseSlotMinutes(start);
  return minutes == null ? '' : minutesToSlot(minutes + 30);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveConsultationProjectPaymentTotals(quotation: InstanceType<typeof ServiceQuotation>) {
  const subtotal = Math.max(
    0,
    Number(quotation.subtotal || 0) || Number(quotation.total || 0) || 0,
  );
  const normalizedTaxRate =
    Number.isFinite(CONSULTATION_PROJECT_TAX_RATE) && CONSULTATION_PROJECT_TAX_RATE > 0
      ? CONSULTATION_PROJECT_TAX_RATE
      : 0;
  const gst =
    Number(quotation.gst || 0) > 0
      ? roundCurrency(Number(quotation.gst || 0))
      : roundCurrency(subtotal * normalizedTaxRate);
  return {
    subtotal,
    gst,
    total: roundCurrency(subtotal + gst),
  };
}

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
    images: Array.isArray(line.images) ? line.images.filter(Boolean) : undefined,
    skuId: line.skuId ? String(line.skuId) : undefined,
    variantId: line.variantId ? String(line.variantId) : undefined,
    addonIds: line.addonIds.map((id) => String(id)),
    scheduledDate: schedule?.scheduledDate,
    scheduledTimeStart: schedule?.scheduledTimeStart,
    scheduledTimeEnd: schedule?.scheduledTimeEnd,
    timeSlot: schedule?.timeSlot,
    serviceFlowType: line.serviceFlowType,
    bookingKind: line.bookingKind,
    serviceType: line.serviceType,
    consultationMeta: line.consultationMeta,
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
    images: Array.isArray(line.images) ? line.images.filter(Boolean) : undefined,
    schedule: schedule ?? undefined,
    serviceFlowType: line.serviceFlowType,
    bookingKind: line.bookingKind,
    serviceType: line.serviceType,
    consultationMeta: line.consultationMeta,
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
  static async getFirstBookingEligibleCustomerUids(uids: string[]): Promise<string[]> {
    const normalizedUids = Array.from(
      new Set(
        (uids || [])
          .map((uid) => String(uid || '').trim())
          .filter(Boolean),
      ),
    );

    if (normalizedUids.length === 0) {
      return [];
    }

    const priorPaidStatuses = ['paid', 'assigning', 'assigned', 'cancelled', 'refunded'];
    const ineligibleUids = await BookingOrder.distinct('customerUid', {
      customerUid: { $in: normalizedUids },
      status: { $in: priorPaidStatuses },
    });

    const ineligibleSet = new Set(ineligibleUids.map((uid) => String(uid)));
    return normalizedUids.filter((uid) => !ineligibleSet.has(uid));
  }

  /** Helper has effectively reached / started service — highest Book Now cancellation tier. */
  static isBookNowPartnerReached(task: {
    status?: string;
    executionPhase?: 'assigned' | 'on_the_way' | 'arrived' | string | null;
  }): boolean {
    const status = String(task.status || '').toLowerCase();
    const executionPhase = String(task.executionPhase || '').toLowerCase();
    return (
      status === 'started' ||
      status === 'in_progress' ||
      executionPhase === 'arrived'
    );
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
    const lineFlowConfig = resolveBookNowServiceFlowConfig({
      categorySlug: normalized.categorySlug,
      catalogId: normalized.catalogId,
      skuSlug: normalized.skuSlug,
      packageId: normalized.packageId,
      serviceFlowType: normalized.serviceFlowType,
      bookingKind: normalized.bookingKind,
      serviceType: normalized.serviceType,
    });
    const enriched = applyBookingFlowDefaults(normalized, {
      serviceFlowType: normalized.serviceFlowType || lineFlowConfig.serviceFlowType,
      bookingKind: normalized.bookingKind || lineFlowConfig.bookingKind,
      serviceType: normalized.serviceType || lineFlowConfig.serviceType,
      consultationMeta: normalized.consultationMeta,
    });
    const catalogId = enriched.categorySlug!;
    const packageId = enriched.skuSlug!;
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
      images: Array.isArray(normalized.images) ? normalized.images.filter(Boolean) : undefined,
      addonIds: [],
      serviceFlowType: enriched.serviceFlowType,
      bookingKind: enriched.bookingKind,
      serviceType: enriched.serviceType,
      consultationMeta: enriched.consultationMeta,
    };
  }

  /** Legacy path: resolve from MongoDB catalog (e.g. API-only checkout). */
  private static async resolveLineFromCatalog(line: BookingLineInput): Promise<ResolvedLine> {
    const normalized = this.normalizeLineInput(line);
    try {
      return await this.resolveLineFromCatalogOnce(normalized);
    } catch (err) {
      // Hourly always uses catalog pricing; auto-seed if SKUs were never bootstrapped.
      if (err instanceof NotFoundError && isHourlyCatalogLineInput(normalized)) {
        logger.warn(
          'Hourly SKU missing in catalog — seeding Hourly Helper then retrying',
          {
            skuSlug: normalized.skuSlug,
            categorySlug: normalized.categorySlug,
          },
        );
        await BookNowCatalogBootstrap.seedHourlyHelperCatalog();
        return this.resolveLineFromCatalogOnce(normalized);
      }
      throw err;
    }
  }

  private static async resolveLineFromCatalogOnce(normalized: BookingLineInput): Promise<ResolvedLine> {
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
      normalized.durationMinutes,
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
      images: Array.isArray(normalized.images) ? normalized.images.filter(Boolean) : undefined,
      serviceFlowType: normalized.serviceFlowType,
      bookingKind: normalized.bookingKind,
      serviceType: normalized.serviceType,
      consultationMeta: normalized.consultationMeta,
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
    couponCode?: string;
    serviceFlowType?: ServiceFlowType;
    bookingKind?: BookingKind;
    serviceType?: string;
    consultationMeta?: ConsultationBookingMeta;
    gstExempt?: boolean;
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
      couponCode,
      consultationMeta,
    } = params;

    const fulfillmentType = parseBookingFulfillmentType(params.fulfillmentType);
    const {
      serviceFlowType,
      bookingKind,
      serviceType,
      gstExempt,
    } = resolveBookingFlowDefaults({
      serviceFlowType: params.serviceFlowType,
      bookingKind: params.bookingKind,
      serviceType: params.serviceType,
      consultationMeta,
      gstExempt: params.gstExempt,
    });

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
              serviceFlowType,
              bookingKind,
              serviceType,
              consultationMeta,
            },
          ];
    const normalizedRawLines = rawLines.map((line) => {
      const lineFlowConfig = resolveBookNowServiceFlowConfig({
        categorySlug: line.categorySlug,
        skuSlug: line.skuSlug,
        catalogId: line.catalogId,
        packageId: line.packageId,
      });

      return applyBookingFlowDefaults(line, {
        serviceFlowType:
          line.serviceFlowType || serviceFlowType || lineFlowConfig.serviceFlowType,
        bookingKind: line.bookingKind || bookingKind || lineFlowConfig.bookingKind,
        serviceType: line.serviceType || serviceType || lineFlowConfig.serviceType,
        consultationMeta: line.consultationMeta || consultationMeta,
      });
    });

    const normalizedOrderBookingKind =
      bookingKind === 'standard' && normalizedRawLines.length === 1
        ? normalizedRawLines[0]?.bookingKind || bookingKind
        : bookingKind;
    const normalizedOrderServiceFlowType =
      serviceFlowType === 'standard' && normalizedRawLines.length === 1
        ? normalizedRawLines[0]?.serviceFlowType || serviceFlowType
        : serviceFlowType;
    const normalizedOrderServiceType =
      serviceType ||
      (normalizedRawLines.length === 1 ? normalizedRawLines[0]?.serviceType : undefined);
    const normalizedOrderGstExempt =
      gstExempt ||
      normalizedOrderBookingKind === 'consultation' ||
      (normalizedRawLines.length === 1 &&
        resolveBookNowServiceFlowConfig({
          categorySlug: normalizedRawLines[0]?.categorySlug,
          skuSlug: normalizedRawLines[0]?.skuSlug,
          catalogId: normalizedRawLines[0]?.catalogId,
          packageId: normalizedRawLines[0]?.packageId,
        }).gstExempt);

    if (isConsultationBookingKind(normalizedOrderBookingKind) && normalizedRawLines.length !== 1) {
      throw new BadRequestError('Consultation checkout currently supports exactly one service');
    }

    if (!normalizedRawLines[0]?.skuSlug && !normalizedRawLines[0]?.packageId) {
      throw new BadRequestError('At least one service item is required');
    }

    const legacySchedule: BookNowScheduleInput = {
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      timeSlot,
    };

    const looksHourlyInput = normalizedRawLines.some((line) => isHourlyCatalogLineInput(line));
    const isInstantHourly = looksHourlyInput && fulfillmentType === 'instant';

    if (isInstantHourly) {
      assertHourlyInstantOperatingHours({
        startHour: config.HOURLY_INSTANT_START_HOUR,
        endHour: config.HOURLY_INSTANT_END_HOUR,
      });
    }

    const perItemScheduling =
      !isInstantHourly && usesPerItemBookNowScheduling(normalizedRawLines, normalizedRawLines.length);

    if (perItemScheduling) {
      normalizedRawLines.forEach((line, index) => {
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
      const line0 = normalizedRawLines[0];
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

    const resolvedLines = await Promise.all(normalizedRawLines.map((line) => this.resolveLine(line)));

    assertHourlySingleVisitCheckout({
      lines: resolvedLines,
      fulfillmentType: looksHourlyInput || resolvedLines.some(isHourlyResolvedLine)
        ? fulfillmentType
        : undefined,
    });

    assertBookNowFixedPriceMinimumCheckout(resolvedLines);

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
        lineSchedule: normalizedRawLines[index],
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

    const pricing = normalizedOrderGstExempt
      ? {
          ...computeBookingTotals(
            resolvedLinesWithSchedule.reduce((sum, line) => sum + line.lineTotal, 0),
          ),
          categories: resolvedLinesWithSchedule.map((line) => ({
            categoryKey: line.categorySlug,
            subtotal: line.lineTotal,
            gstPercentage: 0,
            gstAmount: 0,
          })),
        }
      : await (async () => {
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

          return pricingResult.totals;
        })();
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
      serviceFlowType: normalizedOrderServiceFlowType,
      bookingKind: normalizedOrderBookingKind,
      serviceType: normalizedOrderServiceType,
      pricingProfile: normalizedOrderGstExempt ? { gstExempt: true } : undefined,
      consultationMeta: consultationMeta || resolvedLinesWithSchedule[0]?.consultationMeta,
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
          serviceFlowType: line.serviceFlowType || normalizedOrderServiceFlowType,
          bookingKind: line.bookingKind || normalizedOrderBookingKind,
          serviceType: line.serviceType || normalizedOrderServiceType,
          consultationMeta: line.consultationMeta || consultationMeta,
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
      const normalizedCouponCode = String(couponCode || '').trim().toUpperCase() || undefined;

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
          serviceFlowType: normalizedOrderServiceFlowType,
          bookingKind: normalizedOrderBookingKind,
          ...(normalizedOrderServiceType ? { serviceType: normalizedOrderServiceType } : {}),
          ...(normalizedOrderGstExempt ? { gstExempt: true } : {}),
          itemCount: resolvedLinesWithSchedule.length,
          skuSlugs: resolvedLinesWithSchedule.map((l) => l.packageSlug),
          couponServiceIds: resolvedLinesWithSchedule.map((l) => l.categorySlug || l.packageSlug),
          couponLineItems: (() => {
            const byService = new Map<string, number>();
            for (const line of resolvedLinesWithSchedule) {
              const serviceId = String(line.categorySlug || line.packageSlug || '').trim();
              if (!serviceId) continue;
              // Coupon applies on service (pre-GST) amount; GST is recalculated on discounted subtotals at payment.
              byService.set(
                serviceId,
                (byService.get(serviceId) || 0) + (Number(line.lineTotal) || 0),
              );
            }
            return [...byService.entries()].map(([serviceId, amt]) => ({
              serviceId,
              amount: Math.round(amt * 100) / 100,
            }));
          })(),
          gstByCategory: pricing.categories,
          useExtraCoins: applyCoins && coinDiscountRequest > 0,
          requestedCoinDiscountRupees: coinDiscountRequest,
          ...(normalizedCouponCode ? { couponCode: normalizedCouponCode } : {}),
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

      const escrowMeta =
        escrowResult.escrow?.metadata && typeof escrowResult.escrow.metadata === 'object'
          ? (escrowResult.escrow.metadata as Record<string, unknown>)
          : {};
      if (escrowMeta.couponCode) {
        order.couponCode = String(escrowMeta.couponCode);
        order.couponId = escrowMeta.couponId ? String(escrowMeta.couponId) : null;
        order.couponDiscount =
          escrowMeta.couponDiscount != null ? Number(escrowMeta.couponDiscount) : null;
        order.totalBeforeCoupon =
          escrowMeta.totalBeforeCoupon != null
            ? Number(escrowMeta.totalBeforeCoupon)
            : pricing.total;
        order.totalAfterCoupon =
          escrowMeta.totalAfterCoupon != null
            ? Number(escrowMeta.totalAfterCoupon)
            : null;
      }

      // Keep order.total in sync with what Razorpay will charge (after coupon/coins).
      const breakdown =
        escrowMeta.amountBreakdown && typeof escrowMeta.amountBreakdown === 'object'
          ? (escrowMeta.amountBreakdown as Record<string, unknown>)
          : null;
      const finalPayableRaw =
        breakdown?.finalPayableAmount != null
          ? Number(breakdown.finalPayableAmount)
          : escrowMeta.totalAfterCoupon != null
            ? Number(escrowMeta.totalAfterCoupon)
            : null;
      if (finalPayableRaw != null && Number.isFinite(finalPayableRaw) && finalPayableRaw >= 0) {
        order.total = finalPayableRaw;
        if (breakdown?.gst != null && Number.isFinite(Number(breakdown.gst))) {
          order.gst = Number(breakdown.gst);
        }
        if (breakdown?.taskAmount != null && Number.isFinite(Number(breakdown.taskAmount))) {
          order.subtotal = Number(breakdown.taskAmount);
        }
      }

      await order.save();

      logger.info('Book Now booking checkout created (tasks deferred until payment)', {
        orderId,
        customerUid,
        total: order.total,
        totalBeforeCoupon: order.totalBeforeCoupon ?? pricing.total,
        couponCode: order.couponCode || undefined,
        itemCount: resolvedLinesWithSchedule.length,
      });

      const rawOrder =
        escrowResult.order && typeof escrowResult.order === 'object'
          ? (escrowResult.order as Record<string, unknown>)
          : null;
      const razorpayOrder = rawOrder
        ? {
            ...rawOrder,
            id: rawOrder.id,
            amount: rawOrder.amount,
            currency: rawOrder.currency || 'INR',
            ...(typeof rawOrder.keyId === 'string' ? { keyId: rawOrder.keyId } : {}),
          }
        : escrowResult.order;

      if (!razorpayOrder || typeof (razorpayOrder as { keyId?: string }).keyId !== 'string') {
        logger.warn('Book Now razorpayOrder missing keyId — client may use divergent checkout key', {
          orderId,
          razorpayOrderId: (razorpayOrder as { id?: string } | null)?.id,
        });
      }

      return {
        order,
        item: createdItems[0],
        items: createdItems,
        task: null,
        tasks: [],
        escrow: escrowResult.escrow,
        razorpayOrder,
      };
    } catch (error) {
      await BookingOrder.findByIdAndDelete(order._id);
      for (const item of createdItems) {
        await BookingItem.findByIdAndDelete(item._id);
      }
      throw error;
    }
  }

  static async createConsultationProjectOrderFromQuotation(params: {
    consultationTask: InstanceType<typeof Task>;
    quotation: InstanceType<typeof ServiceQuotation>;
    projectTitle?: string;
    projectStartDate?: string | Date;
  }) {
    const { consultationTask, quotation } = params;

    const customerUid =
      String(consultationTask.requesterUid || '').trim() ||
      (consultationTask.requesterId
        ? String(await ProfileUtils.getUidByProfileId(consultationTask.requesterId) || '').trim()
        : '');

    if (!customerUid) {
      throw new BadRequestError('Unable to resolve consultation customer for project payment');
    }

    if (!consultationTask.requesterUid) {
      consultationTask.requesterUid = customerUid;
      await consultationTask.save();
    }

    if (quotation.projectBookingOrderId) {
      const existingOrder = await BookingOrder.findOne({
        orderId: quotation.projectBookingOrderId,
      });
      if (existingOrder) {
        const items = await BookingItem.find({ orderId: existingOrder.orderId }).sort({ createdAt: 1 });
        const taskIds = items.map((item) => item.taskId).filter(Boolean);
        const tasks = taskIds.length
          ? await Task.find({ _id: { $in: taskIds } }).sort({ createdAt: 1 })
          : [];
        const escrow = existingOrder.paymentEscrowId
          ? await PaymentClient.getEscrowByEscrowId(existingOrder.paymentEscrowId)
          : null;

        return {
          order: existingOrder,
          item: items[0] || null,
          items,
          task: tasks[0] || null,
          tasks,
          escrow: escrow || undefined,
          razorpayOrder: existingOrder.razorpayOrderId
            ? {
                id: existingOrder.razorpayOrderId,
                amount: Math.round(Number(existingOrder.total || 0) * 100),
                currency: 'INR',
              }
            : undefined,
        };
      }
    }

    const plan = buildConsultationProjectPlan({
      task: consultationTask,
      quotation,
      projectTitle: params.projectTitle,
      projectStartDate: params.projectStartDate,
    });
    const paymentTotals = resolveConsultationProjectPaymentTotals(quotation);
    const orderId = crypto.randomUUID();
    const categorySlug =
      String(consultationTask.categorySlug || '').trim() ||
      (String(consultationTask.serviceType || '').trim().toLowerCase() === 'painting'
        ? 'painting'
        : '') ||
      String(consultationTask.category || '').trim();
    const categoryLabel =
      String(consultationTask.categoryLabel || '').trim() ||
      resolveBookNowCategoryLabel(categorySlug);
    const pendingLine: ResolvedLine = {
      addonIds: [],
      packageSlug: `consultation-project-${quotation._id}`,
      categorySlug,
      categoryLabel,
      taskCategory:
        String(consultationTask.category || '').trim() ||
        resolveBookNowTaskCategory(categorySlug),
      pricingUnit: 'fixed',
      quantity: 1,
      lineTotal: paymentTotals.total,
      durationMinutes: Math.max(30, Number(plan.estimatedDuration || 0)),
      title: plan.projectTitle,
      snapshotName: plan.projectTitle,
      schedule: resolveBookNowLineSchedule({
        lineSchedule: {
          scheduledDate: plan.scheduledDate,
          scheduledTimeStart: plan.scheduledTimeStart,
          scheduledTimeEnd: plan.scheduledTimeEnd,
          timeSlot: plan.timeSlot,
          durationMinutes: Math.max(30, Number(plan.estimatedDuration || 0)),
        },
        catalogDurationMinutes: Math.max(30, Number(plan.estimatedDuration || 0)),
      }) ?? undefined,
      serviceFlowType: 'consultation_project',
      bookingKind: 'project',
      serviceType: consultationTask.serviceType || 'painting',
      consultationMeta: {
        samePartnerPreferred: consultationTask.consultationState?.samePartnerPreferred,
        consultationFee: consultationTask.consultationState?.consultationFee,
        customerRequirements: consultationTask.consultationState?.customerRequirements,
        estimateSnapshot: consultationTask.consultationState?.estimateSnapshot,
        sourceTaskId: String(consultationTask._id),
        sourceQuotationId: String(quotation._id),
        projectTitle: plan.projectTitle,
      },
    };

    const orderSchedule = orderScheduleFromLine(pendingLine);
    const address = {
      label: undefined,
      line1: String(consultationTask.location?.address || 'Consultation address').trim(),
      line2: undefined,
      city: String(consultationTask.location?.city || '').trim() || 'Unknown',
      state: String(consultationTask.location?.state || '').trim() || undefined,
      pinCode: String(consultationTask.location?.pinCode || '').trim() || '000000',
      coordinates:
        Array.isArray(consultationTask.location?.coordinates) &&
        consultationTask.location.coordinates.length === 2
          ? (consultationTask.location.coordinates as [number, number])
          : undefined,
    };

    const order = await BookingOrder.create({
      orderId,
      customerUid,
      customerProfileId: consultationTask.requesterId,
      status: 'awaiting_payment',
      address,
      scheduledDate: orderSchedule.scheduledDate,
      scheduledTimeStart: orderSchedule.scheduledTimeStart,
      scheduledTimeEnd: orderSchedule.scheduledTimeEnd,
      timeSlot: orderSchedule.timeSlot,
      subtotal: paymentTotals.subtotal,
      addonsTotal: 0,
      platformFee: 0,
      gst: paymentTotals.gst,
      total: paymentTotals.total,
      pendingLines: [serializePendingLine(pendingLine)],
      bookingNotes: quotation.scopeSummary || quotation.notes || consultationTask.description,
      serviceFlowType: 'consultation_project',
      bookingKind: 'project',
      serviceType: consultationTask.serviceType || 'painting',
      pricingProfile: { gstExempt: false },
      consultationMeta: pendingLine.consultationMeta,
    });

    const item = await BookingItem.create({
      orderId,
      addonIds: [],
      quantity: 1,
      unitPrice: paymentTotals.total,
      lineTotal: paymentTotals.total,
      skuSnapshot: {
        name: plan.projectTitle,
        slug: pendingLine.packageSlug,
        categorySlug,
      },
      serviceFlowType: 'consultation_project',
      bookingKind: 'project',
      serviceType: consultationTask.serviceType || 'painting',
      consultationMeta: pendingLine.consultationMeta,
      ...bookingItemScheduleFields(pendingLine),
    });

    try {
      const placeholderTaskId = pendingBookNowTaskId(orderId);
      const escrowResult = await PaymentClient.createBookingEscrow({
        taskId: placeholderTaskId,
        bookingOrderId: orderId,
        posterUid: customerUid,
        amount: paymentTotals.total,
        taskAmount: paymentTotals.subtotal,
        taskCategory: pendingLine.taskCategory,
        taskTitle: plan.projectTitle,
        metadata: {
          bookingOrderId: orderId,
          bookingMode: 'consultation_project',
          serviceFlowType: 'consultation_project',
          bookingKind: 'project',
          serviceType: consultationTask.serviceType || 'painting',
          sourceTaskId: String(consultationTask._id),
          sourceQuotationId: String(quotation._id),
          projectTitle: plan.projectTitle,
	          amountBreakdown: {
	            taskAmount: paymentTotals.subtotal,
	            gst: paymentTotals.gst,
	            platformFee: 0,
	            totalPaid: paymentTotals.total,
	          },
          bookNowLineItems: [
            {
	              taskId: `${placeholderTaskId}:${pendingLine.packageSlug}`,
	              taskTitle: plan.projectTitle,
	              lineAmountRupees: paymentTotals.total,
              catalogId: categorySlug,
              categorySlug,
              pricingUnit: 'fixed',
              scheduledDate: pendingLine.schedule?.scheduledDate,
              scheduledTimeStart: pendingLine.schedule?.scheduledTimeStart,
              scheduledTimeEnd: pendingLine.schedule?.scheduledTimeEnd,
              timeSlot: pendingLine.schedule?.timeSlot,
              durationMinutes: pendingLine.schedule?.durationMinutes ?? pendingLine.durationMinutes,
            },
          ],
        },
      });

      if (!escrowResult.success || !escrowResult.order?.id || !escrowResult.escrow?.escrowId) {
        throw new BadRequestError(escrowResult.error || 'Failed to create project payment order');
      }

      order.paymentEscrowId = escrowResult.escrow.escrowId;
      order.razorpayOrderId = escrowResult.order.id || escrowResult.escrow?.razorpayOrderId;
      await order.save();

      quotation.status = 'accepted';
      quotation.acceptedAt = quotation.acceptedAt || new Date();
      quotation.projectBookingOrderId = order.orderId;
      quotation.projectPaymentStatus = 'awaiting_payment';
      await quotation.save();

      await Task.findByIdAndUpdate(consultationTask._id, {
        $set: {
          'consultationState.currentStage': 'quotation_accepted',
          'consultationState.currentQuotationId': quotation._id,
          'consultationState.projectBookingOrderId': order.orderId,
          'consultationState.lastUpdatedAt': new Date(),
        },
      });

      const rawOrder =
        escrowResult.order && typeof escrowResult.order === 'object'
          ? (escrowResult.order as Record<string, unknown>)
          : null;
      const razorpayOrder = rawOrder
        ? {
            ...rawOrder,
            id: rawOrder.id,
            amount: rawOrder.amount,
            currency: rawOrder.currency || 'INR',
            ...(typeof rawOrder.keyId === 'string' ? { keyId: rawOrder.keyId } : {}),
          }
        : escrowResult.order;

      return {
        order,
        item,
        items: [item],
        task: null,
        tasks: [],
        escrow: escrowResult.escrow,
        razorpayOrder,
      };
    } catch (error) {
      await BookingItem.findByIdAndDelete(item._id);
      await BookingOrder.findByIdAndDelete(order._id);
      throw error;
    }
  }

  private static mergeTaskForAutoAssign(
    task: InstanceType<typeof Task>,
    line: ResolvedLine,
    order: InstanceType<typeof BookingOrder>,
  ): InstanceType<typeof Task> {
    const hydrated = {
      ...(task.toObject() as ITask),
    } as ITask;
    const paintingFlow =
      line.serviceFlowType === 'consultation_project' ||
      order.serviceFlowType === 'consultation_project';

    if (!hydrated.categorySlug && line.categorySlug) {
      hydrated.categorySlug = line.categorySlug;
    }
    if (
      !hydrated.categorySlug &&
      (String(line.serviceType || order.serviceType || '')
        .trim()
        .toLowerCase() === 'painting' ||
        paintingFlow)
    ) {
      hydrated.categorySlug = 'painting';
    }
    if (!hydrated.serviceType) {
      hydrated.serviceType =
        line.serviceType || order.serviceType || (paintingFlow ? 'painting' : undefined);
    }
    if (!hydrated.serviceFlowType) {
      hydrated.serviceFlowType = line.serviceFlowType || order.serviceFlowType;
    }
    if (!hydrated.bookingKind) {
      hydrated.bookingKind = line.bookingKind || order.bookingKind;
    }
    if (!hydrated.subcategory && line.packageSlug) {
      hydrated.subcategory = line.packageSlug;
    }

    return hydrated as unknown as InstanceType<typeof Task>;
  }

  private static async selfHealUnassignedBookNowTasks(
    order: InstanceType<typeof BookingOrder>,
    items: InstanceType<typeof BookingItem>[],
    tasks: InstanceType<typeof Task>[],
  ): Promise<void> {
    for (const task of tasks) {
      if (task.assigneeUid || task.bookingSource !== 'book_now') continue;
      const item = items.find((row) => String(row.taskId) === String(task._id));
      if (!item) continue;

      const pseudoLine: ResolvedLine = {
        addonIds: [],
        packageSlug: String(item.skuSnapshot?.slug || ''),
        categorySlug: String(item.skuSnapshot?.categorySlug || ''),
        categoryLabel: String(item.skuSnapshot?.name || ''),
        taskCategory: 'other',
        pricingUnit: 'fixed',
        quantity: 1,
        lineTotal: Number(item.lineTotal || 0),
        durationMinutes: Number(item.durationMinutes || 60),
        title: String(item.skuSnapshot?.name || task.title || 'Book Now'),
        snapshotName: String(item.skuSnapshot?.name || ''),
        serviceFlowType: item.serviceFlowType || order.serviceFlowType,
        bookingKind: item.bookingKind || order.bookingKind,
        serviceType: item.serviceType || order.serviceType,
      };

      try {
        await BookNowAutoAssignService.autoAssign(
          BookingService.mergeTaskForAutoAssign(task, pseudoLine, order) as any,
        );
      } catch (err) {
        logger.error('[BookNowAutoAssign] Self-heal auto-assign failed', {
          taskId: task._id,
          orderId: order.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private static async materializeBookingTasks(
    order: InstanceType<typeof BookingOrder>,
  ): Promise<InstanceType<typeof Task>[]> {
    const items = await BookingItem.find({ orderId: order.orderId }).sort({ createdAt: 1 });
    const existingTaskIds = items.map((item) => item.taskId).filter(Boolean);

    const rawPending = (order.pendingLines || []) as PendingBookingLine[];
    const consultationSourceTaskId = String(order.consultationMeta?.sourceTaskId || '').trim();
    const consultationSourceQuotationId = String(order.consultationMeta?.sourceQuotationId || '').trim();
    const isConsultationProjectOrder =
      order.serviceFlowType === 'consultation_project' &&
      order.bookingKind === 'project' &&
      consultationSourceTaskId.length > 0 &&
      consultationSourceQuotationId.length > 0;
    const sourceConsultationTask = isConsultationProjectOrder
      ? await Task.findById(consultationSourceTaskId)
      : null;
    const sourceQuotation = isConsultationProjectOrder
      ? await ServiceQuotation.findById(consultationSourceQuotationId)
      : null;
    if (isConsultationProjectOrder && (!sourceConsultationTask || !sourceQuotation)) {
      throw new BadRequestError('Consultation project order is missing its source quotation data');
    }

    if (existingTaskIds.length > 0) {
      const existingTasks = await Task.find({ _id: { $in: existingTaskIds } }).sort({ createdAt: 1 });
      if (
        isConsultationProjectOrder &&
        sourceConsultationTask &&
        sourceQuotation &&
        existingTasks.some((task) => String(task._id) === String(sourceConsultationTask._id))
      ) {
        const transitionPatch = buildConsultationTaskProjectTransitionPatch({
          task: sourceConsultationTask as any,
          quotation: sourceQuotation as any,
          projectTitle: order.consultationMeta?.projectTitle,
          projectStartDate: order.scheduledDate,
          projectBookingOrderId: order.orderId,
          bookingItemId: items[0]?._id ? String(items[0]._id) : undefined,
          requesterUid: order.customerUid,
        });

        await Task.updateOne(
          { _id: sourceConsultationTask._id },
          {
            $set: transitionPatch,
            $unset: {
              startOtp: '',
              onTheWayAt: '',
              arrivedAt: '',
              startedAt: '',
              completedAt: '',
              completionSubmittedAt: '',
              completionApprovedAt: '',
              completionProof: '',
              completionNotes: '',
              completionStatus: '',
              cancelledAt: '',
              cancelledById: '',
              cancellationReason: '',
              reviewAt: '',
              firstCompletedAt: '',
            },
          },
        );
        await ServiceQuotation.updateOne(
          { _id: sourceQuotation._id },
          {
            $set: {
              projectTaskId: sourceConsultationTask._id,
              projectPaymentStatus: order.status === 'awaiting_payment' ? 'awaiting_payment' : 'paid',
              updatedAt: new Date(),
            },
          },
        );
        const refreshedTasks = await Task.find({ _id: { $in: existingTaskIds } }).sort({ createdAt: 1 });
        await BookingService.selfHealUnassignedBookNowTasks(order, items, refreshedTasks);
        return Task.find({ _id: { $in: existingTaskIds } }).sort({ createdAt: 1 });
      }
      await BookingService.selfHealUnassignedBookNowTasks(order, items, existingTasks);
      return existingTasks;
    }

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
      const taskPayload =
        isConsultationProjectOrder && sourceConsultationTask && sourceQuotation
          ? null
          : {
              title: line.title,
              description,
              category: normalizeBookNowTaskCategory(line.taskCategory),
              categorySlug:
                line.categorySlug ||
                (String(line.serviceType || order.serviceType || '')
                  .trim()
                  .toLowerCase() === 'painting'
                  ? 'painting'
                  : undefined),
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
              urgency: 'medium' as const,
              priority: 'normal' as const,
              status: 'open' as const,
              requesterId: order.customerProfileId,
              scheduledDate: line.schedule?.scheduledDateValue ?? order.scheduledDate,
              scheduledTimeStart: line.schedule?.scheduledTimeStart ?? order.scheduledTimeStart,
              scheduledTimeEnd: line.schedule?.scheduledTimeEnd ?? order.scheduledTimeEnd,
              timeSlot: line.schedule?.timeSlot ?? order.timeSlot,
              flexibility: 'strict' as const,
              estimatedDuration: line.schedule?.durationMinutes ?? line.durationMinutes,
              images: Array.isArray(line.images) ? line.images.filter(Boolean) : undefined,
              views: 0,
              isFeatured: false,
              currentRevisionRound: 0,
              negotiationStatus: 'closed' as const,
              bookingSource: 'book_now' as const,
              bookingOrderId: order.orderId,
              assignmentStatus: 'pending' as const,
              serviceFlowType: line.serviceFlowType || order.serviceFlowType || 'standard',
              bookingKind: line.bookingKind || order.bookingKind || 'standard',
              serviceType:
                line.serviceType ||
                order.serviceType ||
                (line.serviceFlowType === 'consultation_project' ||
                order.serviceFlowType === 'consultation_project'
                  ? 'painting'
                  : undefined),
              consultationState:
                isConsultationBookingKind(line.bookingKind || order.bookingKind)
                  ? buildConsultationTaskState({
                      lineTotal: line.lineTotal,
                      lineConsultationMeta: line.consultationMeta,
                      orderConsultationMeta: order.consultationMeta,
                    })
                  : undefined,
            };

      const item = items[index];

      if (isConsultationProjectOrder && sourceConsultationTask && sourceQuotation) {
        if (item) {
          item.taskId = sourceConsultationTask._id;
          await item.save();
        }

        const transitionPatch = buildConsultationTaskProjectTransitionPatch({
          task: sourceConsultationTask as any,
          quotation: sourceQuotation as any,
          projectTitle: order.consultationMeta?.projectTitle,
          projectStartDate: line.schedule?.scheduledDateValue ?? order.scheduledDate,
          projectBookingOrderId: order.orderId,
          bookingItemId: item ? String(item._id) : undefined,
          requesterUid: order.customerUid,
        });

        const transitionedTask = await Task.findByIdAndUpdate(
          sourceConsultationTask._id,
          {
            $set: transitionPatch,
            $unset: {
              startOtp: '',
              onTheWayAt: '',
              arrivedAt: '',
              startedAt: '',
              completedAt: '',
              completionSubmittedAt: '',
              completionApprovedAt: '',
              completionProof: '',
              completionNotes: '',
              completionStatus: '',
              cancelledAt: '',
              cancelledById: '',
              cancellationReason: '',
              reviewAt: '',
              firstCompletedAt: '',
            },
          },
          { new: true, runValidators: true },
        );

        if (!transitionedTask) {
          throw new BadRequestError('Failed to transition consultation task into project execution');
        }

        createdTasks.push(transitionedTask);

        try {
          const preferredPartnerUid =
            String(
              sourceConsultationTask.assigneeUid || sourceConsultationTask.partnerUid || '',
            ).trim() || undefined;
          const taskForAssign = BookingService.mergeTaskForAutoAssign(
            transitionedTask,
            line,
            order,
          );
          const result = await BookNowAutoAssignService.autoAssign(taskForAssign as any, {
            preferredPartnerUid,
          });
          const postedArea =
            transitionedTask.location?.taskArea ||
            (transitionedTask.location as any)?.locality ||
            transitionedTask.location?.city ||
            'N/A';
          const timeInfo =
            transitionedTask.scheduledTimeStart || transitionedTask.timeSlot || 'Flexible';
          const catInfo = line.categoryLabel || transitionedTask.category || 'N/A';

          logger.info(`================================================================================`);
          logger.info(`📢 [BookNowWorkPosted] CONSULTATION PROJECT POSTED!`);
          logger.info(`   Task ID           : ${transitionedTask._id}`);
          logger.info(`   Task Title        : "${transitionedTask.title}"`);
          logger.info(`   Category          : ${catInfo}`);
          logger.info(`   Work Posted Area  : ${postedArea}`);
          logger.info(`   Work Scheduled    : ${timeInfo}`);
          logger.info(`--------------------------------------------------------------------------------`);
          if (result.assigned && result.partner) {
            logger.info(`✅ AUTO-ASSIGNMENT STATUS: SUCCESS`);
            logger.info(`   Partner Name      : ${result.partner.name}`);
            logger.info(`   Partner UID       : ${result.partner.uid}`);
            logger.info(`   Partner Profile ID: ${result.partner.profileId}`);
          } else {
            logger.info(`⚠️ AUTO-ASSIGNMENT STATUS: UNASSIGNED`);
            logger.info(`   Reason            : ${result.reason ?? 'No matching approved partner found'}`);
          }
          logger.info(`================================================================================`);
        } catch (autoAssignErr) {
          logger.error(
            '[BookNowAutoAssign] ❌ Auto-assignment error (consultation project):',
            autoAssignErr,
          );
        }

        await ServiceQuotation.updateOne(
          { _id: sourceQuotation._id },
          {
            $set: {
              projectTaskId: sourceConsultationTask._id,
              projectPaymentStatus: 'paid',
              updatedAt: new Date(),
            },
          },
        );
        continue;
      }

      const task = await Task.create(taskPayload);
      createdTasks.push(task);

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
          serviceFlowType: line.serviceFlowType || order.serviceFlowType || 'standard',
          bookingKind: line.bookingKind || order.bookingKind || 'standard',
          serviceType: line.serviceType || order.serviceType,
          consultationMeta: line.consultationMeta || order.consultationMeta,
          ...bookingItemScheduleFields(line),
        });
        await Task.findByIdAndUpdate(task._id, { bookingItemId: String(createdItem._id) });
      }

      // ─── AUTO-ASSIGN: Immediately find nearest partner and assign ───────────
      try {
        const taskForAssign = BookingService.mergeTaskForAutoAssign(task, line, order);
        const result = await BookNowAutoAssignService.autoAssign(taskForAssign as any);
        const postedArea = task.location?.taskArea || (task.location as any)?.locality || task.location?.city || 'N/A';
        const timeInfo = task.scheduledTimeStart || task.timeSlot || 'Flexible';
        const catInfo = line.categoryLabel || task.category || 'N/A';

        logger.info(`================================================================================`);
        logger.info(`📢 [BookNowWorkPosted] NEW BOOK NOW WORK POSTED!`);
        logger.info(`   Task ID           : ${task._id}`);
        logger.info(`   Task Title        : "${task.title}"`);
        logger.info(`   Category          : ${catInfo}`);
        logger.info(`   Work Posted Area  : ${postedArea}`);
        logger.info(`   Work Scheduled    : ${timeInfo}`);
        logger.info(`--------------------------------------------------------------------------------`);
        if (result.assigned && result.partner) {
          const distStr = result.partner.distKm !== null ? `${result.partner.distKm.toFixed(2)} km` : 'Location Not Set';
          logger.info(`✅ AUTO-ASSIGNMENT STATUS: SUCCESS`);
          logger.info(`   Partner Name      : ${result.partner.name}`);
          logger.info(`   Partner UID       : ${result.partner.uid}`);
          logger.info(`   Partner Profile ID: ${result.partner.profileId}`);
          logger.info(`   Assigned Work Area: "${result.partner.workArea}" (${result.partner.workAreaDistKm.toFixed(2)} km from task)`);
          logger.info(`   Partner Distance  : ${distStr}`);
        } else {
          logger.info(`⚠️ AUTO-ASSIGNMENT STATUS: UNASSIGNED`);
          logger.info(`   Reason            : ${result.reason ?? 'No matching approved partner found within 5km'}`);
          logger.info(`   Action Required   : Operations team manual assignment`);
        }
        logger.info(`================================================================================`);
      } catch (autoAssignErr) {
        logger.error('[BookNowAutoAssign] ❌ Auto-assignment error:', autoAssignErr);
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
    return abandonUnpaidBookingOrder(orderId, customerUid);
  }

  static async getSlotAvailability(date: string, city: string) {
    const occupied = await getOccupiedBookNowSlots(date, city);
    return {
      date: String(date || '').trim(),
      city: String(city || '').trim(),
      ...occupied,
    };
  }

  static async getRescheduleEligibility(orderId: string, customerUid: string) {
    const order = await BookingOrder.findOne({ orderId }).select(
      'orderId customerUid status address scheduledDate scheduledTimeStart scheduledTimeEnd timeSlot rescheduleCount bookingKind serviceType consultationMeta fulfillmentType total',
    );
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');

    const items = await BookingItem.find({ orderId, status: { $ne: 'cancelled' } })
      .select('taskId skuSnapshot serviceFlowType bookingKind serviceType consultationMeta lineTotal durationMinutes')
      .lean();
    const taskIds = items.map((item) => item.taskId).filter(Boolean);
    const tasks = taskIds.length
      ? await Task.find({ _id: { $in: taskIds } })
          .select('status assigneeId assigneeUid executionPhase startedAt arrivedAt')
          .lean()
      : [];
    const rescheduleCount = Number(order.rescheduleCount || 0);
    const remainingReschedules = Math.max(0, MAX_ONE_TIME_RESCHEDULES - rescheduleCount);
    const scheduledAt = resolveScheduledAt({
      scheduledDate: order.scheduledDate,
      scheduledTimeStart: order.scheduledTimeStart,
    });

    if (!['paid', 'assigning', 'assigned'].includes(String(order.status || '').toLowerCase())) {
      return {
        allowed: false,
        chargeRequired: false,
        reasonCode: 'STATUS_BLOCKED',
        partnerState: 'unassigned',
        message: `Cannot reschedule booking in status ${order.status}`,
        rescheduleCount,
        rescheduleLimit: MAX_ONE_TIME_RESCHEDULES,
        remainingReschedules,
        maxReschedules: MAX_ONE_TIME_RESCHEDULES,
      };
    }
    if (rescheduleCount >= MAX_ONE_TIME_RESCHEDULES) {
      return {
        allowed: false,
        chargeRequired: false,
        reasonCode: 'RESCHEDULE_LIMIT_REACHED',
        partnerState: 'unassigned',
        message: 'This booking has already been rescheduled twice. Please contact support.',
        rescheduleCount,
        rescheduleLimit: MAX_ONE_TIME_RESCHEDULES,
        remainingReschedules,
        maxReschedules: MAX_ONE_TIME_RESCHEDULES,
      };
    }
    const tasksById = new Map(tasks.map((task) => [String(task._id), task]));
    const evaluatedLines = items.length
      ? items.map((item) => {
          const linkedTask = item.taskId ? tasksById.get(String(item.taskId)) : null;
          const partnerState = resolveReschedulePartnerState({
            assigneeId: linkedTask?.assigneeId,
            assigneeUid: linkedTask?.assigneeUid,
            executionPhase: linkedTask?.executionPhase,
            startedAt: linkedTask?.startedAt,
            arrivedAt: linkedTask?.arrivedAt,
            status: linkedTask?.status,
          });
          const isHourlyLine = Boolean(
            item.durationMinutes && Number(item.durationMinutes) > 0 &&
            String(item.skuSnapshot?.categorySlug || '').trim().toLowerCase() === 'hourly-helper',
          );
          return evaluateBookingLineReschedulePolicy({
            kind:
              String(item.bookingKind || order.bookingKind || '').trim().toLowerCase() === 'consultation'
                ? 'consultation'
                : isHourlyLine || String(order.fulfillmentType || '').trim().toLowerCase() === 'instant'
                  ? 'hourly'
                  : 'standard',
            partnerState,
            scheduledAt,
            categorySlug: item.skuSnapshot?.categorySlug,
            serviceType: item.serviceType || order.serviceType,
            bookingKind: item.bookingKind || order.bookingKind,
            consultationFee:
              item.consultationMeta?.consultationFee ??
              order.consultationMeta?.consultationFee ??
              null,
            lineTotal: Number(item.lineTotal || 0),
          });
        })
      : [
          evaluateBookingLineReschedulePolicy({
            kind:
              String(order.bookingKind || '').trim().toLowerCase() === 'consultation'
                ? 'consultation'
                : String(order.fulfillmentType || '').trim().toLowerCase() === 'instant'
                  ? 'hourly'
                  : 'standard',
            partnerState: resolveReschedulePartnerState({
              assigneeId: undefined,
              assigneeUid: undefined,
              executionPhase: undefined,
              startedAt: undefined,
              arrivedAt: undefined,
              status: order.status,
            }),
            scheduledAt,
            serviceType: order.serviceType,
            bookingKind: order.bookingKind,
            consultationFee: order.consultationMeta?.consultationFee ?? null,
            lineTotal: Number(order.total || 0),
          }),
        ];

    const blockedDecision = evaluatedLines.find((decision) => !decision.allowed);
    const mostSeverePartnerState = evaluatedLines.reduce<ReschedulePartnerState>(
      (current, decision) =>
        partnerStateSeverity(decision.partnerState) > partnerStateSeverity(current)
          ? decision.partnerState
          : current,
      'unassigned',
    );
    const totalChargeAmount = evaluatedLines.reduce(
      (sum, decision) => sum + Number(decision.chargeAmount || 0),
      0,
    );
    const leadDecision =
      blockedDecision ||
      evaluatedLines.find((decision) => decision.partnerState === 'on_the_way') ||
      evaluatedLines.find((decision) => decision.chargeRequired) ||
      evaluatedLines[0];

    return {
      allowed: !blockedDecision,
      chargeRequired: !blockedDecision && totalChargeAmount > 0,
      chargeAmount: !blockedDecision && totalChargeAmount > 0 ? totalChargeAmount : undefined,
      reasonCode: leadDecision.reasonCode,
      partnerState: mostSeverePartnerState,
      policyWindowLabel: leadDecision.policyWindowLabel,
      message: blockedDecision
        ? blockedDecision.message
        : totalChargeAmount > 0
          ? `Existing cancellation charge applies: ₹${totalChargeAmount.toLocaleString('en-IN')}.`
          : leadDecision.message,
      rescheduleCount,
      rescheduleLimit: MAX_ONE_TIME_RESCHEDULES,
      remainingReschedules,
      maxReschedules: MAX_ONE_TIME_RESCHEDULES,
    };
  }

  static async getRescheduleSlots(orderId: string, customerUid: string, date: string) {
    const eligibility = await BookingService.getRescheduleEligibility(orderId, customerUid);
    if (!eligibility.allowed) {
      throw new BadRequestError(eligibility.message || 'This booking cannot be rescheduled');
    }
    const order = await BookingOrder.findOne({ orderId }).select('customerUid address').lean();
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');

    const dateKey = String(date || '').trim();
    parseCalendarDate(dateKey);
    const city = String(order.address?.city || '').trim();
    const occupied = await getOccupiedBookNowSlots(dateKey, city);
    const blocked = new Set(occupied.occupiedTimeStarts.map(normalizeBookNowSlotLabel));
    const slots = RESCHEDULE_SLOT_STARTS.map((start) => {
      const normalized = normalizeBookNowSlotLabel(start);
      const unavailable = blocked.has(normalized) || isBookNowSlotWithinLeadTime(normalized, dateKey);
      return {
        id: normalized,
        label: normalized,
        startTime: normalized,
        endTime: defaultSlotEnd(normalized),
        available: !unavailable,
      };
    });

    return { date: dateKey, slots };
  }

  static async rescheduleOrder(
    orderId: string,
    customerUid: string,
    params: {
      scheduledDate?: string;
      scheduledTimeStart?: string;
      scheduledTimeEnd?: string;
      reason?: string;
    },
  ) {
    const eligibility = await BookingService.getRescheduleEligibility(orderId, customerUid);
    if (!eligibility.allowed) {
      throw new BadRequestError(eligibility.message || 'This booking cannot be rescheduled');
    }

    const dateKey = String(params.scheduledDate || '').trim();
    const scheduledDate = parseCalendarDate(dateKey);
    const scheduledTimeStart = normalizeBookNowSlotLabel(String(params.scheduledTimeStart || '').trim());
    if (!scheduledTimeStart) throw new BadRequestError('scheduledTimeStart is required');
    const scheduledTimeEnd =
      String(params.scheduledTimeEnd || '').trim() || defaultSlotEnd(scheduledTimeStart);
    const timeSlot = deriveBookNowTimeSlot(scheduledTimeStart);

    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    await assertBookNowSlotAvailable({
      date: dateKey,
      city: order.address.city,
      scheduledTimeStart,
      timeSlot,
    });

    order.scheduledDate = scheduledDate;
    order.scheduledTimeStart = scheduledTimeStart;
    order.scheduledTimeEnd = scheduledTimeEnd;
    order.timeSlot = timeSlot;
    order.rescheduleCount = Number(order.rescheduleCount || 0) + 1;
    order.lastRescheduledAt = new Date();
    await order.save();

    const items = await BookingItem.find({ orderId, status: { $ne: 'cancelled' } });
    const taskIds = items.map((item) => item.taskId).filter(Boolean);
    await Promise.all([
      ...items.map((item) => {
        item.scheduledDate = scheduledDate;
        item.scheduledTimeStart = scheduledTimeStart;
        item.scheduledTimeEnd = scheduledTimeEnd;
        item.timeSlot = timeSlot;
        return item.save();
      }),
      taskIds.length
        ? Task.updateMany(
            { _id: { $in: taskIds } },
            {
              $set: {
                scheduledDate,
                scheduledTimeStart,
                scheduledTimeEnd,
                timeSlot,
                dateOption: 'on-date',
                lastRescheduledAt: order.lastRescheduledAt,
                executionPhase: 'assigned',
                executionPhaseUpdatedAt: order.lastRescheduledAt,
              },
              $unset: {
                startOtp: 1,
                onTheWayAt: 1,
                arrivedAt: 1,
              },
              $inc: { rescheduleCount: 1 },
            },
          )
        : Promise.resolve(),
    ]);

    logger.info('Booking rescheduled by customer', {
      orderId,
      customerUid,
      scheduledDate: dateKey,
      scheduledTimeStart,
      reason: params.reason,
    });

    return { order, items };
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
        const task =
          (await Task.findById(params.taskId).lean()) ||
          (await (async () => {
            const linkedItems = await BookingItem.find({ orderId: order.orderId })
              .select('taskId')
              .lean();
            const linkedTaskId = linkedItems.find((item) => item.taskId)?.taskId;
            return linkedTaskId ? Task.findById(linkedTaskId).lean() : null;
          })());
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

    const autoAssigned = tasks.length > 0 && tasks.every((task) => Boolean(task.assigneeUid));
    order.status = autoAssigned ? 'assigned' : 'assigning';
    await order.save();

    const primaryTaskId = tasks[0] ? String(tasks[0]._id) : params.taskId;

    if (autoAssigned && params.escrowId && tasks[0]?.assigneeUid) {
      try {
        await PaymentClient.attachPerformerToEscrow({
          escrowId: params.escrowId,
          performerUid: tasks[0].assigneeUid,
        });
      } catch (err: any) {
        logger.warn('Failed to attach performer to consultation project escrow after payment', {
          orderId: order.orderId,
          escrowId: params.escrowId,
          error: err.message,
        });
      }
    }

    logger.info('Book Now order marked paid', {
      orderId: order.orderId,
      status: order.status,
      taskId: primaryTaskId,
      taskCount: tasks.length,
    });

    return { success: true, order, tasks };
  }

  /** Detect Hourly Helper order from items / pending lines / linked tasks. */
  static async isHourlyBookingOrder(orderId: string): Promise<boolean> {
    const order = await BookingOrder.findOne({ orderId }).select('pendingLines').lean();
    if (!order) return false;
    const items = await BookingItem.find({ orderId }).select('skuSnapshot taskId').lean();
    const taskIds = items.map((i) => i.taskId).filter(Boolean);
    const tasks = taskIds.length
      ? await Task.find({ _id: { $in: taskIds } })
          .select('categorySlug budget.type')
          .lean()
      : [];

    return isHourlyBookingFromHints([
      ...items.map((item) => ({
        categorySlug: item.skuSnapshot?.categorySlug,
        skuSlug: item.skuSnapshot?.slug,
      })),
      ...((order.pendingLines || []) as Array<Record<string, unknown>>).map((line) => ({
        categorySlug: (line.categorySlug as string) || undefined,
        skuSlug: (line.skuSlug as string) || (line.packageId as string) || undefined,
        pricingUnit: (line.pricingUnit as string) || undefined,
      })),
      ...tasks.map((task) => ({
        categorySlug: task.categorySlug,
        pricingUnit: task.budget?.type,
      })),
    ]);
  }

  /** Multi-day consultation project order (bookingKind project on order or task). */
  static async isProjectBookingOrder(orderId: string): Promise<boolean> {
    const order = await BookingOrder.findOne({ orderId }).select('bookingKind').lean();
    if (String(order?.bookingKind || '').trim().toLowerCase() === 'project') {
      return true;
    }
    const items = await BookingItem.find({ orderId }).select('taskId bookingKind').lean();
    if (items.some((i) => String(i.bookingKind || '').trim().toLowerCase() === 'project')) {
      return true;
    }
    const taskIds = items.map((i) => i.taskId).filter(Boolean);
    if (!taskIds.length) return false;
    const projectTask = await Task.findOne({
      _id: { $in: taskIds },
      $or: [
        { bookingKind: 'project' },
        { projectExecution: { $exists: true, $ne: null } },
      ],
    })
      .select('_id')
      .lean();
    return Boolean(projectTask);
  }

  /**
   * Multi-day project cancel — evaluate proration, settle via payment precomputed settlement,
   * then cancel booking/tasks. Allows cancel while in_progress (unlike standard Book Now).
   */
  static async cancelProjectBookingOrder(
    orderId: string,
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
    const taskIds = items.map((i) => i.taskId).filter(Boolean);
    const tasks = taskIds.length ? await Task.find({ _id: { $in: taskIds } }) : [];
    const primaryTask =
      tasks.find((t) => String((t as { bookingKind?: string }).bookingKind || '') === 'project') ||
      tasks.find((t) => Boolean((t as { projectExecution?: unknown }).projectExecution)) ||
      tasks[0];

    if (!primaryTask) {
      throw new NotFoundError('Project task not found for this booking');
    }

    const execution = (primaryTask as {
      projectExecution?: {
        status?: string;
        totalPlannedDays?: number;
        completedDayCount?: number;
        activeDayNumber?: number | null;
        plannedStartDate?: Date;
      };
    }).projectExecution;

    const partnerAssigned = isHelperAssignedOnTask(primaryTask);
    const partnerReachedLocation =
      partnerAssigned && BookingService.isBookNowPartnerReached(primaryTask);

    const projectStartDate = new Date(
      execution?.plannedStartDate ||
        primaryTask.scheduledDate ||
        order.scheduledDate ||
        order.createdAt,
    );
    const cancelledAt = new Date();
    const paidRupees = Number(order.total || order.subtotal || 0);
    const paidAmountPaise = Math.max(0, Math.round(paidRupees * 100));

    const evaluation = evaluateProjectCancellation({
      paidAmountPaise,
      cancelledAt,
      projectStartDate,
      partnerAssigned,
      partnerReachedLocation,
      projectStatus: execution?.status || null,
      totalPlannedDays: Number(execution?.totalPlannedDays || 1),
      completedDayCount: Number(execution?.completedDayCount || 0),
      activeDayNumber:
        execution?.activeDayNumber == null ? null : Number(execution.activeDayNumber),
      taskStatus: String(primaryTask.status || ''),
    });

    if (evaluation.status === 'DENIED') {
      throw new BadRequestError(
        evaluation.reason || 'Cannot cancel this project',
        evaluation.reasonCode || 'PROJECT_CANCEL_DENIED',
      );
    }

    const cancelReason =
      reason || evaluation.reason || 'Multi-day project cancelled by customer';

    if (order.paidAt) {
      const payResult = await PaymentClient.cancelHourlyWithSettlement({
        bookingOrderId: orderId,
        escrowId: order.paymentEscrowId || undefined,
        taskId: String(primaryTask._id),
        reason: cancelReason,
        userId: customerUid,
        cancelledBy: 'poster',
        taskStartDate: projectStartDate.toISOString(),
        assignedAt: primaryTask.assignedAt
          ? new Date(primaryTask.assignedAt).toISOString()
          : null,
        settlement: evaluation.settlement,
      });
      if (!payResult.success) {
        throw new BadRequestError(
          payResult.error || 'Failed to settle project cancellation payment',
          'PROJECT_SETTLEMENT_FAILED',
        );
      }
    }

    for (const task of tasks) {
      if (String(task.status || '') === 'cancelled') continue;
      task.status = 'cancelled';
      task.cancelledAt = cancelledAt;
      task.cancellationReason = cancelReason;
      if (task.projectExecution) {
        const pe = task.projectExecution as {
          status?: string;
          activeDayNumber?: number | null;
          completedAt?: Date;
        };
        if (pe.status !== 'completed' && pe.status !== 'ended_early') {
          pe.status = 'ended_early';
          pe.activeDayNumber = null;
          pe.completedAt = cancelledAt;
          task.markModified('projectExecution');
        }
      }
      await task.save();
    }

    for (const item of items) {
      if (item.status === 'cancelled') continue;
      item.status = 'cancelled';
      item.cancelledAt = cancelledAt;
      item.cancellationReason = cancelReason;
      await item.save();
    }

    order.status = order.paidAt ? 'refunded' : 'cancelled';
    order.cancelledAt = cancelledAt;
    order.cancellationReason = cancelReason;
    await order.save();

    logger.info('Project booking cancelled', {
      orderId,
      taskId: String(primaryTask._id),
      tier: evaluation.tier,
      policyKey: evaluation.policyKey,
      refundAmountPaise: evaluation.settlement.refundAmountPaise,
      workDaysCounted: evaluation.workDaysCounted,
    });

    return {
      order,
      items,
      projectCancellation: evaluation,
    };
  }

  /**
   * Hourly Helper cancel — evaluate fees, execute CancellationSettlement via payment,
   * then persist snapshot and cancel booking/tasks.
   */
  static async cancelHourlyBookingOrder(
    orderId: string,
    customerUid: string,
    reason?: string,
  ): Promise<{
    order: Awaited<ReturnType<typeof BookingOrder.findOne>>;
    items: Awaited<ReturnType<typeof BookingItem.find>>;
    hourlyCancellation: HourlyCancellationOrchestratorResult;
    settlementPending: boolean;
  }> {
    const hourlyCancellation = await cancelHourlyBooking({
      orderId,
      actorUid: customerUid,
      cancelledBy: 'CUSTOMER',
    });

    if (
      hourlyCancellation.outcome === 'EVALUATED' &&
      hourlyCancellation.result?.status === 'DENIED'
    ) {
      throw new BadRequestError(
        hourlyCancellation.result.reason || 'Cannot cancel this booking',
        hourlyCancellation.result.reasonCode,
      );
    }

    if (hourlyCancellation.outcome === 'UNPAID_ABANDONED') {
      const order = await BookingOrder.findOne({ orderId });
      if (!order) throw new NotFoundError('Booking not found');
      const items = await BookingItem.find({ orderId });
      return {
        order,
        items,
        hourlyCancellation,
        settlementPending: false,
      };
    }

    if (hourlyCancellation.outcome === 'IDEMPOTENT') {
      const order = await BookingOrder.findOne({ orderId });
      if (!order) throw new NotFoundError('Booking not found');
      const items = await BookingItem.find({ orderId });
      return {
        order,
        items,
        hourlyCancellation,
        settlementPending: false,
      };
    }

    const result = hourlyCancellation.result;
    if (!result || result.status !== 'ALLOWED') {
      throw new BadRequestError('Hourly cancellation could not be evaluated');
    }

    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    const items = await BookingItem.find({ orderId });
    const taskIds = items.map((i) => i.taskId).filter(Boolean);
    const tasks = taskIds.length
      ? await Task.find({ _id: { $in: taskIds } })
      : [];
    const primaryTask = tasks[0];
    const primaryItem = items.find((i) => i.status !== 'cancelled') || items[0];

    const taskStartDate = (
      primaryTask?.scheduledDate ||
      primaryItem?.scheduledDate ||
      order.scheduledDate ||
      order.createdAt
    ).toISOString();
    const assignedAtIso = primaryTask?.assignedAt
      ? new Date(primaryTask.assignedAt).toISOString()
      : null;

    const cancelReason =
      reason || result.reason || 'Hourly Helper cancelled by customer';

    // Payment first — settlement only, no fee recalculation.
    if (order.paidAt) {
      const payResult = await PaymentClient.cancelHourlyWithSettlement({
        bookingOrderId: orderId,
        escrowId: order.paymentEscrowId || undefined,
        taskId: primaryTask ? String(primaryTask._id) : undefined,
        reason: cancelReason,
        userId: customerUid,
        cancelledBy: 'poster',
        taskStartDate,
        assignedAt: assignedAtIso,
        settlement: result.settlement,
      });
      if (!payResult.success) {
        throw new BadRequestError(
          payResult.error || 'Failed to settle hourly cancellation payment',
          'HOURLY_SETTLEMENT_FAILED',
        );
      }
    }

    const evaluatedAt = new Date();
    order.cancellationResult = {
      ...result,
      evaluatedAt: evaluatedAt.toISOString(),
      cancelledBy: 'CUSTOMER',
    };
    order.status = order.paidAt ? 'refunded' : 'cancelled';
    order.cancelledAt = evaluatedAt;
    order.cancellationReason = cancelReason;

    for (const task of tasks) {
      if (task.status === 'cancelled') continue;
      task.status = 'cancelled';
      task.cancelledAt = evaluatedAt;
      task.cancellationReason = cancelReason;
      await task.save();
    }

    for (const item of items) {
      if (item.status === 'cancelled') continue;
      item.status = 'cancelled';
      item.cancelledAt = evaluatedAt;
      item.cancellationReason = cancelReason;
      await item.save();
    }

    await order.save();

    logger.info('Hourly cancellation settled and finalized', {
      orderId,
      reasonCode: result.reasonCode,
      refundAmountPaise: result.settlement.refundAmountPaise,
      workerCompensationPaise: result.settlement.workerCompensationPaise,
    });

    return {
      order,
      items,
      hourlyCancellation: {
        ...hourlyCancellation,
        bookingStatus: order.status,
      },
      settlementPending: false,
    };
  }

  static async cancelBookingItem(
    orderId: string,
    taskId: string,
    customerUid: string,
    reason?: string,
  ) {
    // Hourly Helper is a single-visit order — cancel the whole booking.
    if (await BookingService.isHourlyBookingOrder(orderId)) {
      return BookingService.cancelHourlyBookingOrder(orderId, customerUid, reason);
    }

    // Multi-day consultation project — dedicated proration policy.
    if (await BookingService.isProjectBookingOrder(orderId)) {
      return BookingService.cancelProjectBookingOrder(orderId, customerUid, reason);
    }

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
    if (task.status !== 'open' && task.status !== 'assigned') {
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
    const partnerAssigned = isHelperAssignedOnTask(task);
    const partnerReachedLocation =
      partnerAssigned && BookingService.isBookNowPartnerReached(task);

    logger.info('Book Now item cancel: assignment gate', {
      orderId,
      taskId: String(taskId),
      partnerAssigned,
      partnerReachedLocation,
      paid: Boolean(order.paidAt),
    });

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
          partnerAssigned,
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
          partnerAssigned,
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
    if (await BookingService.isHourlyBookingOrder(orderId)) {
      return BookingService.cancelHourlyBookingOrder(orderId, customerUid, reason);
    }

    if (await BookingService.isProjectBookingOrder(orderId)) {
      return BookingService.cancelProjectBookingOrder(orderId, customerUid, reason);
    }

    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');
    if (['cancelled', 'refunded'].includes(order.status)) {
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

      if (order.paidAt && !refundInitiated) {
        const firstItem = items.find((i) => String(i.taskId) === String(task._id)) || items[0];
        const partnerAssigned = isHelperAssignedOnTask(task);
        const assignedAtIso = task.assignedAt
          ? new Date(task.assignedAt).toISOString()
          : null;
        const partnerReachedLocation =
          partnerAssigned && BookingService.isBookNowPartnerReached(task);
        logger.info('Book Now order cancel: assignment gate', {
          orderId,
          taskId: String(task._id),
          partnerAssigned,
          partnerReachedLocation,
          paid: true,
        });
        const refundResult = await PaymentClient.cancelPaymentForTask({
          taskId: String(task._id),
          bookingOrderId: orderId,
          escrowId: order.paymentEscrowId || undefined,
          reason: reason || 'Book Now cancelled by customer',
          userId: customerUid,
          cancelledBy: 'poster',
          taskStartDate: (task.scheduledDate || task.createdAt).toISOString(),
          assignedAt: assignedAtIso,
          feeBaseAmount: order.subtotal,
          taskTitle: task.title,
          catalogId: firstItem?.skuSnapshot?.categorySlug || task.categorySlug,
          partnerReachedLocation,
          partnerAssigned,
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
