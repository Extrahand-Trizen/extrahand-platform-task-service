/**
 * Hourly Helper cancellation orchestrator (Phase 4.2).
 *
 * Builds context, handles unpaid abandon + idempotency, runs pure evaluator.
 * Paid settlement + booking finalization is owned by BookingService.cancelHourlyBookingOrder.
 */

import logger from '../../config/logger';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors/AppError';
import BookingItem from '../../models/BookingItem';
import BookingOrder, { type IBookingOrder } from '../../models/BookingOrder';
import Task from '../../models/Task';
import { abandonUnpaidBookingOrder } from '../bookingAbandonUnpaid';
import {
  buildHourlyCancellationContext,
  isHourlyBookingFromHints,
  isPersistedCancellationResult,
  toHourlyCancellationResult,
} from './cancellationContext';
import { evaluateHourlyCancellation } from './cancellationEvaluator';
import type {
  CancelledBy,
  HourlyCancellationOrchestratorResult,
  HourlyCancellationResult,
  PersistedHourlyCancellationResult,
} from './cancellationTypes';

export type CancelHourlyBookingParams = {
  orderId: string;
  /** Firebase uid of the actor initiating the call. */
  actorUid: string;
  cancelledBy: CancelledBy;
  /** Optional override — defaults to server now. */
  cancelledAt?: Date;
};

function assertActorAllowed(params: {
  cancelledBy: CancelledBy;
  actorUid: string;
  customerUid: string;
  assigneeUid?: string | null;
}): void {
  const { cancelledBy, actorUid, customerUid, assigneeUid } = params;
  if (cancelledBy === 'CUSTOMER') {
    if (actorUid !== customerUid) {
      throw new ForbiddenError('Not your booking');
    }
    return;
  }
  if (cancelledBy === 'HELPER') {
    if (!assigneeUid || actorUid !== assigneeUid) {
      throw new ForbiddenError('Only the assigned helper can cancel this booking');
    }
    return;
  }
  // PLATFORM / SYSTEM — caller must be trusted upstream (service auth / admin).
  // Orchestrator does not re-validate service tokens here.
}

async function loadHourlyOrderBundle(orderId: string) {
  const order = await BookingOrder.findOne({ orderId });
  if (!order) throw new NotFoundError('Booking not found');

  const items = await BookingItem.find({ orderId });
  const taskIds = items.map((i) => i.taskId).filter(Boolean);
  const tasks = taskIds.length
    ? await Task.find({ _id: { $in: taskIds } })
    : [];

  const hints = [
    ...items.map((item) => ({
      categorySlug: item.skuSnapshot?.categorySlug,
      skuSlug: item.skuSnapshot?.slug,
      pricingUnit: undefined as string | undefined,
    })),
    ...((order.pendingLines || []) as Array<Record<string, unknown>>).map((line) => ({
      categorySlug: (line.categorySlug as string) || undefined,
      skuSlug: (line.skuSlug as string) || (line.packageId as string) || undefined,
      pricingUnit: (line.pricingUnit as string) || undefined,
    })),
    ...tasks.map((task) => ({
      categorySlug: (task as { categorySlug?: string }).categorySlug,
      skuSlug: undefined as string | undefined,
      pricingUnit: (task as { budget?: { type?: string } }).budget?.type,
    })),
  ];

  if (!isHourlyBookingFromHints(hints)) {
    throw new BadRequestError(
      'This cancellation path is only for Hourly Helper bookings',
      'NOT_HOURLY_BOOKING',
    );
  }

  const primaryItem = items.find((i) => i.status !== 'cancelled') || items[0];
  const primaryTask =
    tasks.find((t) => String(t._id) === String(primaryItem?.taskId)) || tasks[0];

  return { order, items, tasks, primaryItem, primaryTask };
}

function readStoredResult(order: IBookingOrder): HourlyCancellationResult | null {
  if (!isPersistedCancellationResult(order.cancellationResult)) return null;
  return toHourlyCancellationResult(
    order.cancellationResult as PersistedHourlyCancellationResult,
  );
}

/**
 * Evaluate (or abandon) an Hourly Helper booking cancellation.
 * Payment settlement and status mutation for paid bookings are intentionally deferred.
 */
export async function cancelHourlyBooking(
  params: CancelHourlyBookingParams,
): Promise<HourlyCancellationOrchestratorResult> {
  const { orderId, actorUid, cancelledBy } = params;
  const cancelledAt = params.cancelledAt || new Date();

  const { order, primaryItem, primaryTask } = await loadHourlyOrderBundle(orderId);

  assertActorAllowed({
    cancelledBy,
    actorUid,
    customerUid: order.customerUid,
    assigneeUid: primaryTask?.assigneeUid,
  });

  // --- Unpaid abandon (never runs fee evaluator) ---
  if (order.status === 'awaiting_payment' && !order.paidAt) {
    const { order: abandonedOrder, abandoned } = await abandonUnpaidBookingOrder(
      orderId,
      order.customerUid,
    );
    logger.info('Hourly cancellation: unpaid abandon path', {
      orderId,
      abandoned,
      actorUid,
    });
    return {
      outcome: 'UNPAID_ABANDONED',
      abandoned,
      orderId,
      bookingStatus: abandonedOrder.status,
    };
  }

  // Already abandoned unpaid (no fee snapshot)
  if (
    (order.status === 'cancelled' || order.status === 'refunded') &&
    !order.paidAt
  ) {
    return {
      outcome: 'UNPAID_ABANDONED',
      abandoned: false,
      orderId,
      bookingStatus: order.status,
    };
  }

  // --- Idempotency: paid cancel already finalized with snapshot ---
  const stored = readStoredResult(order);
  if (
    stored &&
    (order.status === 'cancelled' || order.status === 'refunded')
  ) {
    logger.info('Hourly cancellation: idempotent replay', {
      orderId,
      reasonCode: stored.reasonCode,
    });
    return {
      outcome: 'IDEMPOTENT',
      abandoned: false,
      result: stored,
      orderId,
      bookingStatus: order.status,
    };
  }

  const scheduledDate =
    primaryTask?.scheduledDate ||
    primaryItem?.scheduledDate ||
    order.scheduledDate;
  const scheduledTimeStart =
    primaryTask?.scheduledTimeStart ||
    primaryItem?.scheduledTimeStart ||
    order.scheduledTimeStart;

  const context = buildHourlyCancellationContext({
    paidAmountRupees: Number(order.total) || 0,
    cancelledBy,
    cancelledAt,
    scheduledDate,
    scheduledTimeStart,
    bookingStatus: order.status,
    taskStatus: primaryTask?.status,
    taskExecutionPhase: primaryTask?.executionPhase,
  });

  const result = evaluateHourlyCancellation(context);

  logger.info('Hourly cancellation: evaluated (no payment yet)', {
    orderId,
    status: result.status,
    reasonCode: result.reasonCode,
    customerFeePaise: result.customerFeePaise,
    refundRequired: result.refundRequired,
  });

  return {
    outcome: 'EVALUATED',
    abandoned: false,
    result,
    orderId,
    bookingStatus: order.status,
  };
}
