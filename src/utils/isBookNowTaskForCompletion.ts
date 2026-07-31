/**
 * Book Now identity for completion auto-finalize / raise-issue.
 * Prefer bookingSource / bookingOrderId / bookingItemId — not catalog heuristics.
 */
export function isBookNowTaskForCompletion(task: {
  bookingSource?: string | null;
  bookingOrderId?: unknown;
  bookingItemId?: unknown;
}): boolean {
  if (String(task.bookingSource || '').trim() === 'book_now') return true;
  if (String(task.bookingOrderId || '').trim()) return true;
  return !!String(task.bookingItemId || '').trim();
}
