/**
 * Derive customer payment totals from task budget + paid additional quote requests.
 * Used on list responses so mobile/web can show base + additional without full task detail.
 */

function quoteStatusNorm(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toLowerCase();
}

export function readTaskBudgetAmount(budget: unknown): number {
  if (typeof budget === 'number' && Number.isFinite(budget)) return budget;
  if (typeof budget === 'string') {
    const parsed = Number(budget);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (budget && typeof budget === 'object') {
    const b = budget as Record<string, unknown>;
    const parsed = Number(b.amount ?? b.value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function sumPaidAdditionalQuoteAmount(task: {
  additionalQuoteRequests?: Array<{ status?: unknown; amount?: unknown }>;
}): number {
  const requests = Array.isArray(task.additionalQuoteRequests)
    ? task.additionalQuoteRequests
    : [];
  return requests.reduce((sum, req) => {
    if (quoteStatusNorm(req?.status) !== 'paid') return sum;
    const amount = Number(req?.amount ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export function enrichTaskWithPaymentSummary<T extends Record<string, unknown>>(task: T): T & {
  paidAdditionalAmount: number;
  totalCustomerPaidAmount: number;
} {
  const baseAmount = readTaskBudgetAmount(task.budget);
  const paidAdditionalAmount = sumPaidAdditionalQuoteAmount(
    task as { additionalQuoteRequests?: Array<{ status?: unknown; amount?: unknown }> },
  );
  return {
    ...task,
    paidAdditionalAmount,
    totalCustomerPaidAmount: baseAmount + paidAdditionalAmount,
  };
}

export function enrichTaskListWithPaymentSummary<T extends Record<string, unknown>>(
  tasks: T[],
): Array<T & { paidAdditionalAmount: number; totalCustomerPaidAmount: number }> {
  return tasks.map((t) => enrichTaskWithPaymentSummary(t));
}
