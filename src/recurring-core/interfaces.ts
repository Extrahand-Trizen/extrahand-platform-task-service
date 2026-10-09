import type { RecurringPriceSnapshot, RecurrenceRule, VisitState } from './types';

export type PricingContext = {
  items: unknown[];
  address: unknown;
  visitStart: Date;
};

export interface PricingStrategy {
  quoteVisit(context: PricingContext): Promise<RecurringPriceSnapshot>;
}

export type HelperAssignmentContext = {
  preferredPartnerId?: string | null;
  visitStart: Date;
  address: unknown;
};

export interface HelperAssignmentPolicy {
  resolvePreferredPartnerId(context: HelperAssignmentContext): Promise<string | undefined>;
}

export type FulfilmentCreateInput = {
  customerUid: string;
  customerProfileId: string;
  items: unknown[];
  address: unknown;
  scheduledDate: string;
  scheduledTimeStart: string;
  scheduledTimeEnd?: string;
  notes?: string;
  preferredPartnerId?: string;
  recurringPlanId: string;
  recurringVisitId: string;
  serviceRecipient?: unknown;
};

export type FulfilmentCreateResult = {
  bookingOrderId: string;
  escrowId?: string;
  razorpayOrder?: unknown;
  total: number;
};

export interface FulfilmentTaskCreator {
  createVisitOrder(input: FulfilmentCreateInput): Promise<FulfilmentCreateResult>;
  cancelVisitOrder(bookingOrderId: string, customerUid: string, reason?: string): Promise<{ success: boolean; error?: string }>;
  abandonUnpaidOrder(bookingOrderId: string, customerUid: string): Promise<void>;
  rescheduleVisitOrder(
    bookingOrderId: string,
    customerUid: string,
    params: { scheduledDate: string; scheduledTimeStart: string; scheduledTimeEnd?: string; reason?: string },
  ): Promise<void>;
}

export type EligibilityInput = {
  items: unknown[];
  fulfillmentType?: string;
  rule: RecurrenceRule;
  now?: Date;
};

export interface EligibilityChecker {
  assertEligible(input: EligibilityInput): void;
}

export type PlanTransition = {
  from: string;
  to: string;
  reason?: string;
};

export type VisitTransition = {
  from: VisitState;
  to: VisitState;
};
