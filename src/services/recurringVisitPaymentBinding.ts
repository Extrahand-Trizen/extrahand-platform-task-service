import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

/** Rupee tolerance for float/rounding drift between stored visit amounts and escrow snapshots. */
export const VISIT_AMOUNT_TOLERANCE_RUPEES = 1;

export type EscrowRecord = Record<string, unknown>;

export type VisitEscrowBindingFailure =
  | 'missing'
  | 'not_paid'
  | 'wrong_task'
  | 'wrong_visit'
  | 'unscoped'
  | 'bound_to_other_visit'
  | 'wrong_customer'
  | 'amount_mismatch';

export type VisitEscrowBindingResult =
  | { ok: true; escrowId: string; needsVisitMetadata: boolean }
  | { ok: false; reason: VisitEscrowBindingFailure; message: string };

export function readEscrowRecordId(escrow: EscrowRecord | null | undefined): string {
  if (!escrow) return '';
  return String(escrow.escrowId || escrow.id || '').trim();
}

function readEscrowMetadata(escrow: EscrowRecord | null | undefined): Record<string, unknown> {
  if (!escrow) return {};
  const metadata = escrow.metadata || escrow.meta;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

export function readEscrowVisitId(escrow: EscrowRecord | null | undefined): string {
  return String(readEscrowMetadata(escrow).visitId || '').trim();
}

export function isEscrowRecordPaid(escrow: EscrowRecord | null | undefined): boolean {
  if (!escrow) return false;
  const paymentStatus = String(escrow.paymentStatus || '').toLowerCase();
  const status = String(escrow.status || '').toLowerCase();
  return (
    paymentStatus === 'captured' ||
    paymentStatus === 'authorized' ||
    status === 'held' ||
    status === 'released'
  );
}

/** Base visit amount (excluding fees) the escrow was created for, when recorded. */
export function readEscrowVisitAmountRupees(escrow: EscrowRecord | null | undefined): number | null {
  const metadata = readEscrowMetadata(escrow);
  const breakdown =
    metadata.amountBreakdown && typeof metadata.amountBreakdown === 'object'
      ? (metadata.amountBreakdown as Record<string, unknown>)
      : {};
  for (const raw of [metadata.visitBudgetRupees, breakdown.visitBudgetRupees]) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function resolveExpectedVisitAmount(
  visit: Pick<ScheduleVisitRow, 'amount'>,
  plan: Record<string, unknown> | null | undefined,
): number {
  const fromVisit = Number(visit.amount);
  if (Number.isFinite(fromVisit) && fromVisit > 0) return fromVisit;
  const fromPlan = Number(plan?.budgetPerVisit);
  return Number.isFinite(fromPlan) && fromPlan > 0 ? fromPlan : 0;
}

type OfferAmountSource = {
  proposedBudget?: { amount?: unknown } | null;
  negotiation?: { currentAmount?: unknown; history?: Array<{ at?: unknown }> | null } | null;
  quotationRevisions?: Array<{ revisedAt?: unknown }> | null;
};

function timeOf(value: unknown): number {
  if (!value) return 0;
  const time = new Date(value as string | number | Date).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Amount a recurring plan is accepted at (= Visit 1 price). Budget-revision responses update
 * proposedBudget only and counters update negotiation.currentAmount only, so the newer wins.
 */
export function resolveRecurringAcceptedOfferAmount(application: OfferAmountSource): number {
  const proposed = Number(application.proposedBudget?.amount) || 0;
  const current = Number(application.negotiation?.currentAmount) || 0;
  if (!(current > 0)) return proposed;
  const revisions = application.quotationRevisions ?? [];
  const history = application.negotiation?.history ?? [];
  const revisedAt = timeOf(revisions[revisions.length - 1]?.revisedAt);
  const negotiatedAt = timeOf(history[history.length - 1]?.at);
  if (revisedAt > negotiatedAt && proposed > 0) return proposed;
  return current;
}

export function visitAmountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= VISIT_AMOUNT_TOLERANCE_RUPEES;
}

/** Escrow ids already held by visits other than `visitId`. */
export function collectEscrowIdsBoundToOtherVisits(
  rows: ScheduleVisitRow[],
  visitId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || row.visitId === visitId) continue;
    const escrowId = String(row.escrowId || '').trim();
    if (escrowId) ids.add(escrowId);
  }
  return ids;
}

/**
 * Decide whether `escrow` is a payment for exactly this visit.
 * The escrow's `metadata.visitId` (set when the order was created for the selected visit)
 * is authoritative; it is never moved to another visit here.
 */
export function evaluateVisitEscrowBinding(params: {
  escrow: EscrowRecord | null | undefined;
  parentTaskId: string;
  visitId: string;
  rows: ScheduleVisitRow[];
  expectedAmount?: number;
  requesterUid?: string;
  /** Escrows created before per-visit scoping have no metadata.visitId. */
  allowUnscoped?: boolean;
}): VisitEscrowBindingResult {
  const { escrow, parentTaskId, visitId, rows } = params;
  if (!escrow) {
    return { ok: false, reason: 'missing', message: 'Payment record not found for this visit' };
  }
  const escrowId = readEscrowRecordId(escrow);
  if (!escrowId) {
    return { ok: false, reason: 'missing', message: 'Payment record not found for this visit' };
  }
  if (!isEscrowRecordPaid(escrow)) {
    return { ok: false, reason: 'not_paid', message: 'Payment for this visit has not been captured yet' };
  }

  const escrowTaskId = String(escrow.taskId || '').trim();
  if (escrowTaskId && escrowTaskId !== parentTaskId) {
    return { ok: false, reason: 'wrong_task', message: 'This payment belongs to a different work' };
  }

  const metaVisitId = readEscrowVisitId(escrow);
  if (metaVisitId && metaVisitId !== visitId) {
    return { ok: false, reason: 'wrong_visit', message: 'This payment belongs to a different visit' };
  }
  if (!metaVisitId && !params.allowUnscoped) {
    return { ok: false, reason: 'unscoped', message: 'This payment is not linked to a visit' };
  }

  if (collectEscrowIdsBoundToOtherVisits(rows, visitId).has(escrowId)) {
    return {
      ok: false,
      reason: 'bound_to_other_visit',
      message: 'This payment is already applied to another visit',
    };
  }

  const requesterUid = String(params.requesterUid || '').trim();
  const posterUid = String(escrow.posterUid || '').trim();
  if (requesterUid && posterUid && requesterUid !== posterUid) {
    return { ok: false, reason: 'wrong_customer', message: 'This payment was made by a different customer' };
  }

  const expectedAmount = Number(params.expectedAmount || 0);
  const paidAmount = readEscrowVisitAmountRupees(escrow);
  if (expectedAmount > 0 && paidAmount != null && !visitAmountsMatch(paidAmount, expectedAmount)) {
    return {
      ok: false,
      reason: 'amount_mismatch',
      message: `Paid amount ₹${paidAmount} does not match the visit amount ₹${expectedAmount}`,
    };
  }

  return { ok: true, escrowId, needsVisitMetadata: !metaVisitId };
}
