import { BookNowRecurringErrors } from './config';
import {
  PLAN_STATE_TO_STATUS,
  PLAN_STATUS_TO_STATE,
  TERMINAL_PLAN_STATES,
  TERMINAL_VISIT_STATES,
  VISIT_STATE_TO_STATUS,
  VISIT_STATUS_TO_STATE,
  type PlanState,
  type VisitState,
} from './types';

const PLAN_TRANSITIONS: Record<PlanState, PlanState[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'CANCELLED', 'ENDED'],
  PAUSED: ['CANCELLED', 'ENDED'],
  CANCELLED: [],
  ENDED: [],
};

const VISIT_TRANSITIONS: Record<VisitState, VisitState[]> = {
  SCHEDULED: ['PAYMENT_OPEN', 'CANCELLED'],
  PAYMENT_OPEN: ['PAID', 'UNPAID', 'CANCELLED'],
  PAID: ['IN_PROGRESS', 'CANCELLED', 'COMPLETED'],
  UNPAID: [],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function toPlanState(status: string | null | undefined): PlanState {
  return PLAN_STATUS_TO_STATE[String(status || '').toLowerCase()] || 'DRAFT';
}

export function toPlanStatus(state: PlanState): string {
  return PLAN_STATE_TO_STATUS[state];
}

export function toVisitState(status: string | null | undefined): VisitState {
  return VISIT_STATUS_TO_STATE[String(status || '')] || 'SCHEDULED';
}

export function toVisitStatus(state: VisitState): string {
  return VISIT_STATE_TO_STATUS[state];
}

export function canTransitionPlan(from: PlanState, to: PlanState): boolean {
  return PLAN_TRANSITIONS[from]?.includes(to) === true;
}

export function assertPlanTransition(from: PlanState, to: PlanState): void {
  if (from === to) return;
  if (!canTransitionPlan(from, to)) {
    throw new Error(BookNowRecurringErrors.PLAN_NOT_ACTIVE);
  }
}

export function canTransitionVisit(from: VisitState, to: VisitState): boolean {
  return VISIT_TRANSITIONS[from]?.includes(to) === true;
}

export function isTerminalPlan(state: PlanState): boolean {
  return TERMINAL_PLAN_STATES.has(state);
}

export function isTerminalVisit(state: VisitState): boolean {
  return TERMINAL_VISIT_STATES.has(state);
}

/**
 * Plans never auto-reactivate. Pause after N consecutive unpaid visits while ACTIVE.
 * Ended/cancelled plans stay terminal even if later visits exist.
 */
export function nextPlanStateAfterUnpaid(params: {
  planState: PlanState;
  consecutiveUnpaidCount: number;
  pauseThreshold: number;
}): PlanState {
  if (isTerminalPlan(params.planState)) return params.planState;
  if (params.planState !== 'ACTIVE') return params.planState;
  if (params.consecutiveUnpaidCount >= params.pauseThreshold) return 'PAUSED';
  return 'ACTIVE';
}

export function shouldOpenPayment(params: {
  visitState: VisitState;
  planState: PlanState;
  scheduledAt: Date;
  now: Date;
  leadHours: number;
}): boolean {
  if (params.planState !== 'ACTIVE') return false;
  if (params.visitState !== 'SCHEDULED') return false;
  const openAt = params.scheduledAt.getTime() - params.leadHours * 60 * 60 * 1000;
  return params.now.getTime() >= openAt;
}
