/**
 * Resolves a single instant for when work is expected to start.
 * Used by start-soon schedulers (2h / 30m / 24h windows).
 */
export function resolveWorkStartInstant(task: {
  scheduledDate?: Date | string | null;
  scheduledTimeStart?: string | null;
}): Date | null {
  if (!task.scheduledDate) return null;

  const base = new Date(task.scheduledDate);
  if (Number.isNaN(base.getTime())) return null;

  const timeStr = task.scheduledTimeStart?.trim();
  if (timeStr && /^\d{1,2}:\d{2}/.test(timeStr)) {
    const [hourPart, minutePart] = timeStr.split(':');
    const hours = Number(hourPart);
    const minutes = Number(minutePart);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      base.setHours(hours, minutes, 0, 0);
      return base;
    }
  }

  // No explicit start time — use midday local as a stable default.
  base.setHours(12, 0, 0, 0);
  return base;
}

/** Bump when poster changes schedule so old reminder idempotency keys do not block new sends. */
export function buildScheduleVersion(task: {
  scheduledDate?: Date | string | null;
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;
}): string {
  const start = resolveWorkStartInstant(task);
  const end = task.scheduledTimeEnd ?? '';
  return `${start?.getTime() ?? 'none'}:${end}`;
}
