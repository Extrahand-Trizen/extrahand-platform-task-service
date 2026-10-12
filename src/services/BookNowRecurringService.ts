import mongoose from 'mongoose';
import RecurringPlan, { type IRecurringPlan } from '../models/RecurringPlan';
import RecurringVisit from '../models/RecurringVisit';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { BookNowEligibilityChecker } from '../book-now-adapter/BookNowEligibilityChecker';
import { BookNowPricingStrategy } from '../book-now-adapter/BookNowPricingStrategy';
import { BookNowHelperAssignmentPolicy } from '../book-now-adapter/BookNowHelperAssignmentPolicy';
import { BookNowTaskCreator } from '../book-now-adapter/BookNowTaskCreator';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';
import {
  bookNowRecurringConfig,
  BookNowRecurringErrors,
  PRICE_MAY_VARY_DISCLAIMER,
  computeSafePaymentDeadline,
  dateKeyOfStoredDate,
  generateBookNowVisitSlots,
  nextHorizonSlots,
  shouldOpenPayment,
  toPlanState,
  toPlanStatus,
  toVisitState,
  toVisitStatus,
  isTerminalPlan,
  nextPlanStateAfterUnpaid,
  assertPlanTransition,
  canTransitionVisit,
  type RecurrenceRule,
} from '../recurring-core';
import type { BookingLineInput, BookingAddress } from './BookingService';
import { assertBookNowSlotAvailable } from '../utils/bookNowSlotAvailability';

const eligibility = new BookNowEligibilityChecker();
const pricing = new BookNowPricingStrategy();
const helpers = new BookNowHelperAssignmentPolicy();
const fulfilment = new BookNowTaskCreator();

function requestLog(extra: Record<string, unknown>) {
  return extra;
}

function asRule(plan: IRecurringPlan): RecurrenceRule {
  return {
    pattern: plan.pattern,
    selectedWeekdays: plan.selectedWeekdays,
    startDateKey: dateKeyOfStoredDate(plan.startDate) || '',
    endDateKey: plan.endDate ? dateKeyOfStoredDate(plan.endDate) || undefined : undefined,
    scheduledTimeStart: plan.scheduledTimeStart,
    scheduledTimeEnd: plan.scheduledTimeEnd,
    durationMinutes: plan.durationMinutes,
  };
}

function leadMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export class BookNowRecurringService {
  static async createPlan(params: {
    customerUid: string;
    customerProfileId: mongoose.Types.ObjectId;
    items: BookingLineInput[];
    address: BookingAddress;
    recurrence: RecurrenceRule & { fulfillmentType?: string };
    preferredPartnerId?: string;
    notes?: string;
    serviceRecipient?: unknown;
    requestId?: string;
  }) {
    const now = new Date();
    const rule: RecurrenceRule = {
      pattern: params.recurrence.pattern,
      selectedWeekdays: params.recurrence.selectedWeekdays,
      startDateKey: params.recurrence.startDateKey,
      endDateKey: params.recurrence.endDateKey,
      scheduledTimeStart: params.recurrence.scheduledTimeStart,
      scheduledTimeEnd: params.recurrence.scheduledTimeEnd,
      durationMinutes: params.recurrence.durationMinutes,
    };

    try {
      eligibility.assertEligible({
        items: params.items,
        fulfillmentType: params.recurrence.fulfillmentType || 'scheduled',
        rule,
        now,
      });
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : BookNowRecurringErrors.SERVICE_NOT_ALLOWED);
    }

    const slots = generateBookNowVisitSlots(rule, now);
    const horizon = slots.slice(0, bookNowRecurringConfig.visitHorizon);
    const preferredPartnerId = await helpers.resolvePreferredPartnerId({
      preferredPartnerId: params.preferredPartnerId,
      visitStart: horizon[0].scheduledAt,
      address: params.address,
    });

    const plan = await RecurringPlan.create({
      serviceType: 'book_now',
      status: 'active',
      customerUid: params.customerUid,
      customerProfileId: params.customerProfileId,
      pattern: rule.pattern,
      selectedWeekdays: rule.selectedWeekdays || [],
      startDate: horizon[0].date,
      endDate: rule.endDateKey ? new Date(`${rule.endDateKey}T00:00:00.000Z`) : undefined,
      scheduledTimeStart: rule.scheduledTimeStart,
      scheduledTimeEnd: rule.scheduledTimeEnd,
      durationMinutes: rule.durationMinutes,
      address: params.address,
      lineTemplate: params.items,
      notes: params.notes,
      preferredPartnerId: preferredPartnerId || null,
      serviceRecipient: params.serviceRecipient,
      consecutiveUnpaidCount: 0,
    });

    const planId = plan._id as mongoose.Types.ObjectId;
    await RecurringVisit.insertMany(
      horizon.map((slot) => ({
        parentTaskId: planId,
        planId,
        serviceType: 'book_now',
        visitId: `bnv_${planId}_${slot.visitIndex}`,
        visitIndex: slot.visitIndex,
        date: slot.date,
        scheduledAt: slot.scheduledAt,
        scheduledTimeStart: rule.scheduledTimeStart,
        scheduledTimeEnd: rule.scheduledTimeEnd,
        expectedDurationMinutes: rule.durationMinutes,
        status: 'scheduled',
        paymentStatus: 'pending',
      })),
    );

    logger.info('Book Now recurring plan created', requestLog({
      planId: String(planId),
      customerUid: params.customerUid,
      requestId: params.requestId,
      visitCount: horizon.length,
    }));

    const opened = await this.openDuePaymentsForPlan(String(planId), now, params.requestId);
    return this.getPlanForCustomer(String(planId), params.customerUid, params.requestId, opened);
  }

  static async getPlanForCustomer(
    planId: string,
    customerUid: string,
    requestId?: string,
    checkout?: { visitId: string; razorpayOrder: unknown; bookingOrderId: string; priceSnapshot: unknown } | null,
  ) {
    const plan = await this.requireOwnedPlan(planId, customerUid);
    const visits = await RecurringVisitRepository.listByPlanId(planId);
    logger.info('Book Now recurring plan read', requestLog({
      planId,
      customerUid,
      requestId,
    }));
    return {
      plan: this.serializePlan(plan),
      visits: visits.map((visit) => this.serializeVisit(visit)),
      disclaimer: PRICE_MAY_VARY_DISCLAIMER,
      checkout: checkout || undefined,
    };
  }

  static async listPlansForCustomer(customerUid: string, requestId?: string) {
    const plans = await RecurringPlan.find({ customerUid, serviceType: 'book_now' })
      .sort({ createdAt: -1 })
      .limit(50);
    logger.info('Book Now recurring plans listed', requestLog({ customerUid, requestId, count: plans.length }));
    return { plans: plans.map((plan) => this.serializePlan(plan)), disclaimer: PRICE_MAY_VARY_DISCLAIMER };
  }

  static async listVisitsForCustomer(planId: string, customerUid: string, requestId?: string) {
    await this.requireOwnedPlan(planId, customerUid);
    const visits = await RecurringVisitRepository.listByPlanId(planId);
    logger.info('Book Now recurring visits listed', requestLog({ planId, customerUid, requestId }));
    return { visits: visits.map((visit) => this.serializeVisit(visit)), disclaimer: PRICE_MAY_VARY_DISCLAIMER };
  }

  static async cancelPlan(planId: string, customerUid: string, reason?: string, requestId?: string) {
    const plan = await this.requireOwnedPlan(planId, customerUid);
    const from = toPlanState(plan.status);
    if (isTerminalPlan(from)) {
      return this.getPlanForCustomer(planId, customerUid, requestId);
    }
    assertPlanTransition(from, 'CANCELLED');

    const visits = await RecurringVisitRepository.listByPlanId(planId);
    for (const visit of visits) {
      const state = toVisitState(visit.status);
      if (state === 'COMPLETED' || state === 'CANCELLED' || state === 'UNPAID') continue;
      await this.cancelVisitInternal(visit, customerUid, reason || 'Recurring plan cancelled', true);
    }

    plan.status = 'cancelled';
    plan.cancelledAt = new Date();
    await plan.save();
    logger.info('Book Now recurring plan cancelled', requestLog({ planId, customerUid, requestId }));
    return this.getPlanForCustomer(planId, customerUid, requestId);
  }

  static async cancelVisit(visitMongoId: string, customerUid: string, reason?: string, requestId?: string) {
    const visit = await RecurringVisitRepository.findByMongoId(visitMongoId);
    if (!visit?.planId) throw new NotFoundError('Visit not found');
    const plan = await this.requireOwnedPlan(String(visit.planId), customerUid);
    const start = visit.scheduledAt ? new Date(visit.scheduledAt) : null;
    if (!start || start.getTime() - Date.now() < leadMs(bookNowRecurringConfig.cancelLeadHours)) {
      throw new BadRequestError(BookNowRecurringErrors.CANCEL_LEAD);
    }
    await this.cancelVisitInternal(visit, customerUid, reason || 'Visit cancelled by customer', false);
    logger.info('Book Now recurring visit cancelled', requestLog({
      planId: String(plan._id),
      visitId: visit.visitId,
      customerUid,
      requestId,
    }));
    return this.getPlanForCustomer(String(plan._id), customerUid, requestId);
  }

  static async rescheduleVisit(
    visitMongoId: string,
    customerUid: string,
    params: { scheduledDate: string; scheduledTimeStart: string; scheduledTimeEnd?: string; reason?: string },
    requestId?: string,
  ) {
    const visit = await RecurringVisitRepository.findByMongoId(visitMongoId);
    if (!visit?.planId) throw new NotFoundError('Visit not found');
    const plan = await this.requireOwnedPlan(String(visit.planId), customerUid);
    const state = toVisitState(visit.status);
    if (!canTransitionVisit(state, 'SCHEDULED') && state !== 'SCHEDULED' && state !== 'PAYMENT_OPEN' && state !== 'PAID') {
      throw new BadRequestError(BookNowRecurringErrors.VISIT_NOT_RESCHEDULABLE);
    }
    if (state === 'IN_PROGRESS' || state === 'COMPLETED' || state === 'CANCELLED' || state === 'UNPAID') {
      throw new BadRequestError(BookNowRecurringErrors.VISIT_NOT_RESCHEDULABLE);
    }

    const { resolveVisitStartInstant } = await import('../recurring-core/time');
    const newStart = resolveVisitStartInstant(params.scheduledDate, params.scheduledTimeStart);
    if (!newStart) throw new BadRequestError('Invalid reschedule date or time');
    if (newStart.getTime() - Date.now() < leadMs(bookNowRecurringConfig.rescheduleLeadHours)) {
      throw new BadRequestError(BookNowRecurringErrors.RESCHEDULE_LEAD);
    }

    const address = plan.address as BookingAddress;
    await assertBookNowSlotAvailable({
      date: params.scheduledDate,
      city: address.city,
      scheduledTimeStart: params.scheduledTimeStart,
      durationMinutes: visit.expectedDurationMinutes || plan.durationMinutes,
    });

    if (visit.bookingOrderId && (state === 'PAID' || state === 'PAYMENT_OPEN')) {
      await fulfilment.rescheduleVisitOrder(visit.bookingOrderId, customerUid, params);
    }

    const deadline =
      state === 'PAYMENT_OPEN'
        ? computeSafePaymentDeadline(newStart, new Date(), {
            cutoffMinutes: bookNowRecurringConfig.paymentCutoffHours * 60,
            minWindowMinutes: bookNowRecurringConfig.paymentMinWindowMinutes,
          })
        : visit.paymentDeadline;

    await RecurringVisit.updateOne(
      { _id: visit._id },
      {
        $set: {
          date: new Date(`${params.scheduledDate}T00:00:00.000Z`),
          scheduledAt: newStart,
          scheduledTimeStart: params.scheduledTimeStart,
          scheduledTimeEnd: params.scheduledTimeEnd,
          paymentDeadline: deadline || undefined,
        },
      },
    );

    logger.info('Book Now recurring visit rescheduled', requestLog({
      planId: String(plan._id),
      visitId: visit.visitId,
      customerUid,
      requestId,
    }));
    return this.getPlanForCustomer(String(plan._id), customerUid, requestId);
  }

  static async onVisitOrderPaid(params: {
    recurringPlanId: string;
    recurringVisitId: string;
    bookingOrderId: string;
    escrowId?: string;
    paidAt: Date;
  }) {
    const visit = await RecurringVisitRepository.findByPlanAndVisitId(
      params.recurringPlanId,
      params.recurringVisitId,
    );
    if (!visit) return;
    const state = toVisitState(visit.status);
    if (state === 'PAID' || state === 'IN_PROGRESS' || state === 'COMPLETED') return;
    if (!canTransitionVisit(state, 'PAID') && state !== 'PAYMENT_OPEN') return;

    await RecurringVisit.updateOne(
      { _id: visit._id, status: { $in: ['payment_pending', 'scheduled'] } },
      {
        $set: {
          status: toVisitStatus('PAID'),
          paymentStatus: 'held',
          paidAt: params.paidAt,
          bookingOrderId: params.bookingOrderId,
          escrowId: params.escrowId,
        },
      },
    );
    await RecurringPlan.updateOne(
      { _id: params.recurringPlanId, status: 'active' },
      { $set: { consecutiveUnpaidCount: 0 } },
    );
  }

  static async topUpActivePlans(now = new Date()): Promise<number> {
    const plans = await RecurringPlan.find({ serviceType: 'book_now', status: 'active' })
      .sort({ lastTopUpAt: 1, _id: 1 })
      .limit(50);
    let topped = 0;
    for (const plan of plans) {
      try {
        await this.ensureHorizon(plan, now);
        plan.lastTopUpAt = now;
        await plan.save();
        topped += 1;
      } catch (error) {
        logger.warn('Book Now recurring top-up failed', {
          planId: String(plan._id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return topped;
  }

  static async openDuePayments(now = new Date()): Promise<number> {
    const openBefore = new Date(now.getTime() + leadMs(bookNowRecurringConfig.paymentOpenLeadHours));
    const due = await RecurringVisitRepository.findBookNowScheduledForPaymentOpen({
      limit: 50,
      openBefore,
    });
    let opened = 0;
    for (const visit of due) {
      if (!visit.planId) continue;
      try {
        const result = await this.openVisitPayment(String(visit.planId), visit.visitId, now);
        if (result) opened += 1;
      } catch (error) {
        logger.warn('Book Now recurring payment open failed', {
          planId: String(visit.planId),
          visitId: visit.visitId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return opened;
  }

  static async enforcePaymentDeadlines(now = new Date()): Promise<number> {
    const overdue = await RecurringVisitRepository.findBookNowPaymentOpenOverdue({ limit: 50, now });
    let marked = 0;
    for (const visit of overdue) {
      if (!visit.planId) continue;
      try {
        await this.markVisitUnpaid(String(visit.planId), visit.visitId, now);
        marked += 1;
      } catch (error) {
        logger.warn('Book Now recurring unpaid mark failed', {
          planId: String(visit.planId),
          visitId: visit.visitId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return marked;
  }

  static async runMaintenance(now = new Date()): Promise<void> {
    await this.topUpActivePlans(now);
    await this.openDuePayments(now);
    await this.enforcePaymentDeadlines(now);
  }

  private static async openDuePaymentsForPlan(planId: string, now: Date, requestId?: string) {
    const plan = await RecurringPlan.findById(planId);
    if (!plan || plan.status !== 'active') return null;
    const visits = await RecurringVisitRepository.listByPlanId(planId);
    let checkout: { visitId: string; razorpayOrder: unknown; bookingOrderId: string; priceSnapshot: unknown } | null = null;
    for (const visit of visits) {
      if (
        !shouldOpenPayment({
          visitState: toVisitState(visit.status),
          planState: 'ACTIVE',
          scheduledAt: visit.scheduledAt ? new Date(visit.scheduledAt) : new Date(visit.date),
          now,
          leadHours: bookNowRecurringConfig.paymentOpenLeadHours,
        })
      ) {
        continue;
      }
      const opened = await this.openVisitPayment(planId, visit.visitId, now, requestId);
      if (opened && !checkout) checkout = opened;
    }
    return checkout;
  }

  private static async openVisitPayment(
    planId: string,
    visitId: string,
    now: Date,
    requestId?: string,
  ) {
    const plan = await RecurringPlan.findById(planId);
    if (!plan || toPlanState(plan.status) !== 'ACTIVE') return null;
    const claimed = await RecurringVisitRepository.claimVisitStatus({
      planId: plan._id as mongoose.Types.ObjectId,
      visitId,
      fromStatus: 'scheduled',
      toStatus: 'payment_pending',
      extraSet: { paymentOpenedAt: now, paymentStatus: 'pending' },
    });
    if (!claimed) return null;

    const visitStart = claimed.scheduledAt ? new Date(claimed.scheduledAt) : null;
    if (!visitStart) {
      await RecurringVisit.updateOne({ _id: claimed._id }, { $set: { status: 'scheduled' } });
      return null;
    }

    const deadline = computeSafePaymentDeadline(visitStart, now, {
      cutoffMinutes: bookNowRecurringConfig.paymentCutoffHours * 60,
      minWindowMinutes: bookNowRecurringConfig.paymentMinWindowMinutes,
    });
    if (!deadline) {
      await RecurringVisit.updateOne(
        { _id: claimed._id },
        { $set: { status: 'skipped_unpaid', skipReason: 'expired_before_payment_opened', skippedBy: 'system', skippedAt: now } },
      );
      return null;
    }

    const dateKey = dateKeyOfStoredDate(claimed.date);
    if (!dateKey) {
      await RecurringVisit.updateOne({ _id: claimed._id }, { $set: { status: 'scheduled' } });
      return null;
    }

    try {
      const snapshot = await pricing.quoteVisit({
        items: plan.lineTemplate,
        address: plan.address,
        visitStart,
      });
      const created = await fulfilment.createVisitOrder({
        customerUid: plan.customerUid,
        customerProfileId: String(plan.customerProfileId),
        items: plan.lineTemplate,
        address: plan.address,
        scheduledDate: dateKey,
        scheduledTimeStart: claimed.scheduledTimeStart || plan.scheduledTimeStart,
        scheduledTimeEnd: claimed.scheduledTimeEnd || plan.scheduledTimeEnd,
        notes: plan.notes,
        preferredPartnerId: plan.preferredPartnerId || undefined,
        recurringPlanId: String(plan._id),
        recurringVisitId: claimed.visitId,
        serviceRecipient: plan.serviceRecipient,
      });

      await RecurringVisit.updateOne(
        { _id: claimed._id },
        {
          $set: {
            bookingOrderId: created.bookingOrderId,
            escrowId: created.escrowId,
            paymentDeadline: deadline,
            amount: created.total,
            priceSnapshot: {
              basePrice: snapshot.basePrice,
              platformFee: snapshot.platformFee,
              gst: snapshot.gst,
              totalPrice: snapshot.totalPrice,
              currency: 'INR',
              pricedAt: new Date(snapshot.pricedAt),
            },
          },
        },
      );

      logger.info('Book Now recurring visit payment opened', requestLog({
        planId,
        visitId,
        customerUid: plan.customerUid,
        requestId,
        bookingOrderId: created.bookingOrderId,
      }));

      return {
        visitId,
        razorpayOrder: created.razorpayOrder,
        bookingOrderId: created.bookingOrderId,
        priceSnapshot: snapshot,
      };
    } catch (error) {
      await RecurringVisit.updateOne(
        { _id: claimed._id },
        { $set: { status: 'scheduled', paymentOpenedAt: undefined, paymentStatus: 'pending' }, $unset: { bookingOrderId: 1 } },
      );
      throw error;
    }
  }

  private static async markVisitUnpaid(planId: string, visitId: string, now: Date) {
    const plan = await RecurringPlan.findById(planId);
    if (!plan) return;
    const visit = await RecurringVisitRepository.findByPlanAndVisitId(planId, visitId);
    if (!visit || toVisitState(visit.status) !== 'PAYMENT_OPEN') return;

    if (visit.bookingOrderId) {
      try {
        await fulfilment.abandonUnpaidOrder(visit.bookingOrderId, plan.customerUid);
      } catch (error) {
        logger.warn('Failed to abandon unpaid Book Now recurring order', {
          planId,
          visitId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await RecurringVisit.updateOne(
      { _id: visit._id, status: 'payment_pending' },
      {
        $set: {
          status: toVisitStatus('UNPAID'),
          paymentStatus: 'failed',
          skippedAt: now,
          skippedBy: 'system',
          skipReason: 'payment_deadline',
        },
      },
    );

    const from = toPlanState(plan.status);
    if (isTerminalPlan(from)) return;
    plan.consecutiveUnpaidCount = (plan.consecutiveUnpaidCount || 0) + 1;
    const next = nextPlanStateAfterUnpaid({
      planState: from,
      consecutiveUnpaidCount: plan.consecutiveUnpaidCount,
      pauseThreshold: bookNowRecurringConfig.consecutiveUnpaidPause,
    });
    if (next === 'PAUSED' && from === 'ACTIVE') {
      plan.status = toPlanStatus('PAUSED') as IRecurringPlan['status'];
      plan.pausedAt = now;
      plan.pausedReason = 'consecutive_unpaid';
    }
    await plan.save();
  }

  private static async ensureHorizon(plan: IRecurringPlan, now: Date) {
    if (toPlanState(plan.status) !== 'ACTIVE') return;
    const visits = await RecurringVisitRepository.listByPlanId(plan._id as mongoose.Types.ObjectId);
    const upcomingKeys = visits
      .filter((visit) => ['scheduled', 'payment_pending', 'confirmed', 'in_progress'].includes(String(visit.status)))
      .map((visit) => dateKeyOfStoredDate(visit.date))
      .filter((key): key is string => Boolean(key));
    const existingKeys = visits
      .map((visit) => dateKeyOfStoredDate(visit.date))
      .filter((key): key is string => Boolean(key));
    const additions = nextHorizonSlots(asRule(plan), existingKeys, now).filter(
      (slot) => upcomingKeys.length + 1 <= bookNowRecurringConfig.visitHorizon || !upcomingKeys.includes(slot.dateKey),
    );
    const needed = Math.max(0, bookNowRecurringConfig.visitHorizon - upcomingKeys.length);
    const toInsert = additions.slice(0, needed);
    if (toInsert.length === 0) {
      if (upcomingKeys.length === 0 && visits.every((visit) => ['completed', 'cancelled', 'skipped_unpaid'].includes(String(visit.status)))) {
        const from = toPlanState(plan.status);
        if (from === 'ACTIVE' || from === 'PAUSED') {
          plan.status = 'ended';
          plan.endedAt = now;
        }
      }
      return;
    }
    const maxIndex = visits.reduce((max, visit) => Math.max(max, visit.visitIndex || 0), 0);
    const planId = plan._id as mongoose.Types.ObjectId;
    await RecurringVisit.insertMany(
      toInsert.map((slot, index) => ({
        parentTaskId: planId,
        planId,
        serviceType: 'book_now',
        visitId: `bnv_${planId}_${maxIndex + index + 1}`,
        visitIndex: maxIndex + index + 1,
        date: slot.date,
        scheduledAt: slot.scheduledAt,
        scheduledTimeStart: plan.scheduledTimeStart,
        scheduledTimeEnd: plan.scheduledTimeEnd,
        expectedDurationMinutes: plan.durationMinutes,
        status: 'scheduled',
        paymentStatus: 'pending',
      })),
    );
  }

  private static async cancelVisitInternal(
    visit: { _id: mongoose.Types.ObjectId; status: string; bookingOrderId?: string | null; visitId: string },
    customerUid: string,
    reason: string,
    series: boolean,
  ) {
    const state = toVisitState(visit.status);
    if (state === 'CANCELLED' || state === 'COMPLETED' || state === 'UNPAID') return;
    if (!series && state === 'IN_PROGRESS') {
      throw new BadRequestError(BookNowRecurringErrors.VISIT_NOT_CANCELLABLE);
    }

    if (visit.bookingOrderId && (state === 'PAID' || state === 'PAYMENT_OPEN' || state === 'IN_PROGRESS')) {
      if (state === 'PAYMENT_OPEN') {
        await fulfilment.abandonUnpaidOrder(visit.bookingOrderId, customerUid);
      } else {
        const refund = await fulfilment.cancelVisitOrder(visit.bookingOrderId, customerUid, reason);
        if (!refund.success) {
          throw new BadRequestError(refund.error || 'Refund failed for this visit');
        }
      }
    }

    await RecurringVisit.updateOne(
      { _id: visit._id },
      {
        $set: {
          status: toVisitStatus('CANCELLED'),
          skippedAt: new Date(),
          skippedBy: 'customer',
          skipReason: series ? 'plan_cancelled' : 'customer_cancelled',
        },
      },
    );
  }

  private static async requireOwnedPlan(planId: string, customerUid: string) {
    if (!mongoose.isValidObjectId(planId)) throw new NotFoundError('Recurring plan not found');
    const plan = await RecurringPlan.findById(planId);
    if (!plan || plan.serviceType !== 'book_now') throw new NotFoundError('Recurring plan not found');
    if (plan.customerUid !== customerUid) throw new ForbiddenError(BookNowRecurringErrors.NOT_OWNER);
    return plan;
  }

  private static serializePlan(plan: IRecurringPlan) {
    return {
      id: String(plan._id),
      status: toPlanState(plan.status),
      pattern: plan.pattern,
      selectedWeekdays: plan.selectedWeekdays,
      startDate: dateKeyOfStoredDate(plan.startDate),
      endDate: plan.endDate ? dateKeyOfStoredDate(plan.endDate) : null,
      scheduledTimeStart: plan.scheduledTimeStart,
      scheduledTimeEnd: plan.scheduledTimeEnd,
      preferredPartnerId: plan.preferredPartnerId || null,
      consecutiveUnpaidCount: plan.consecutiveUnpaidCount,
      pausedReason: plan.pausedReason || null,
      disclaimer: PRICE_MAY_VARY_DISCLAIMER,
    };
  }

  private static serializeVisit(visit: {
    _id: mongoose.Types.ObjectId;
    visitId: string;
    visitIndex: number;
    date: Date;
    scheduledAt?: Date;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    status: string;
    paymentStatus?: string;
    bookingOrderId?: string | null;
    paymentDeadline?: Date;
    priceSnapshot?: unknown;
    amount?: number;
  }) {
    return {
      id: String(visit._id),
      visitId: visit.visitId,
      visitIndex: visit.visitIndex,
      date: dateKeyOfStoredDate(visit.date),
      scheduledAt: visit.scheduledAt,
      scheduledTimeStart: visit.scheduledTimeStart,
      scheduledTimeEnd: visit.scheduledTimeEnd,
      state: toVisitState(visit.status),
      paymentStatus: visit.paymentStatus,
      bookingOrderId: visit.bookingOrderId || null,
      paymentDeadline: visit.paymentDeadline || null,
      priceSnapshot: visit.priceSnapshot || null,
      amount: visit.amount,
    };
  }
}
