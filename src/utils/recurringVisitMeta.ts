/**
 * Decode mobile __recur_meta tag from task tags (server-side).
 */

export const RECURRING_META_TAG_PREFIX = '__recur_meta:';

export type RecurringFrequencyPattern =
  | 'daily'
  | 'selected_weekdays'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly';

export type RecurringEndType = 'until_cancelled' | 'end_on_date';

export interface RecurringMetaPayload {
  pattern: RecurringFrequencyPattern;
  selectedWeekdays?: number[];
  endType: RecurringEndType;
  expectedDurationMinutes: number;
  visitTime?: string;
}

export function normalizeWeekdayNumbers(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const days = new Set<number>();
  for (const value of raw) {
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (Number.isFinite(n)) days.add(((n % 7) + 7) % 7);
  }
  return [...days].sort((a, b) => a - b);
}

export function normalizeTaskTags(task: Record<string, unknown> | null | undefined): string[] {
  const tags = task?.tags;
  if (Array.isArray(tags)) {
    return tags
      .map((t) => {
        if (typeof t === 'string') return t.trim();
        if (t && typeof t === 'object') {
          return String(
            (t as { name?: string; label?: string; value?: string }).name ||
              (t as { label?: string }).label ||
              (t as { value?: string }).value ||
              '',
          ).trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof tags === 'string' && tags.trim()) {
    return tags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function decodeRecurringMetaFromTags(
  tags?: string[] | Record<string, unknown> | null,
): RecurringMetaPayload | null {
  const normalized = Array.isArray(tags)
    ? tags.map((t) => String(t).trim()).filter(Boolean)
    : normalizeTaskTags(tags as Record<string, unknown> | null | undefined);
  const raw = normalized.find((t) => String(t).startsWith(RECURRING_META_TAG_PREFIX));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw).slice(RECURRING_META_TAG_PREFIX.length));
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as RecurringMetaPayload;
    if (payload.selectedWeekdays) {
      payload.selectedWeekdays = normalizeWeekdayNumbers(payload.selectedWeekdays);
    }
    return payload;
  } catch {
    return null;
  }
}

export function decodeRecurringMetaFromTask(
  task: Record<string, unknown> | null | undefined,
): RecurringMetaPayload | null {
  if (!task) return null;
  return decodeRecurringMetaFromTags(normalizeTaskTags(task));
}

/** v2 recurring visit plan — distinct from legacy schedule-only recurring. */
export function isRecurringVisitPlanTask(task: Record<string, unknown> | null | undefined): boolean {
  if (!task?.recurring || !(task.recurring as { enabled?: boolean }).enabled) return false;
  const plan = task.recurringPlan as { planVersion?: number } | undefined;
  return plan?.planVersion === 2;
}
