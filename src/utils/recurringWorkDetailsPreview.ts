import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

const TERMINAL_STATUSES = new Set([
  'completed',
  'cancelled',
  'skipped',
  'skipped_unpaid',
]);

function rowKey(row: ScheduleVisitRow): string {
  const visitId = String(row.visitId || '').trim();
  if (visitId) return `id:${visitId}`;
  return `date:${new Date(row.date).toISOString().slice(0, 10)}`;
}

function sortVisits(visits: ScheduleVisitRow[]): ScheduleVisitRow[] {
  return [...visits].sort((a, b) => {
    const ai = Number(a.visitIndex) || 0;
    const bi = Number(b.visitIndex) || 0;
    if (ai !== bi) return ai - bi;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
}

function isTerminal(row: ScheduleVisitRow): boolean {
  return TERMINAL_STATUSES.has(String(row.status || '').toLowerCase());
}

/** Work Details carousel: previous + current + upcoming visit rows only. */
export function selectWorkDetailsPreviewVisits(
  visits: ScheduleVisitRow[],
  activeVisitId?: string | null,
): {
  previewVisits: ScheduleVisitRow[];
  totalListed: number;
  hiddenCount: number;
} {
  const sorted = sortVisits(visits);
  const totalListed = sorted.length;
  if (totalListed === 0) {
    return { previewVisits: [], totalListed: 0, hiddenCount: 0 };
  }

  const activeId = String(activeVisitId || '').trim();
  let currentIdx = activeId
    ? sorted.findIndex((row) => String(row.visitId || '') === activeId)
    : -1;
  if (currentIdx < 0) {
    currentIdx = sorted.findIndex((row) => !isTerminal(row));
  }
  if (currentIdx < 0) {
    currentIdx = sorted.length - 1;
  }

  const current = sorted[currentIdx];
  const completedRows = sorted.filter(
    (row) => String(row.status || '').toLowerCase() === 'completed',
  );
  const previous =
    completedRows.length > 0
      ? completedRows[completedRows.length - 1]
      : currentIdx > 0
        ? sorted[currentIdx - 1]
        : null;

  let upcoming: ScheduleVisitRow | null = null;
  for (let index = currentIdx + 1; index < sorted.length; index += 1) {
    if (!isTerminal(sorted[index])) {
      upcoming = sorted[index];
      break;
    }
  }

  const selected: ScheduleVisitRow[] = [];
  const seen = new Set<string>();
  for (const row of [previous, current, upcoming]) {
    if (!row) continue;
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(row);
  }

  selected.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return {
    previewVisits: selected,
    totalListed,
    hiddenCount: Math.max(0, totalListed - selected.length),
  };
}
