/**
 * Book Now identity for completion auto-finalize.
 * Prefer bookingSource / bookingOrderId — not catalog heuristics.
 */
export function isBookNowTaskForCompletion(task: {
  bookingSource?: string | null;
  bookingOrderId?: unknown;
}): boolean {
  if (task.bookingSource === 'book_now') return true;
  return !!String(task.bookingOrderId || '').trim();
}
