/**
 * Recurring visit collection migration feature flags and defaults.
 * Defaults are safe for existing deployments (legacy embedded fallback enabled).
 */

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/** Default materialized buffer for new collection-backed recurring plans. */
export const DEFAULT_RECURRING_VISIT_BUFFER_SIZE = 7;

/** Legacy embedded buffer default (preserved for unmigrated v2 embedded plans). */
export const LEGACY_EMBEDDED_MATERIALIZED_BUFFER_SIZE = 2;

export const recurringVisitConfig = {
  /** Read visits from RecurringVisit collection when plan uses collection storage. */
  collectionReads: envFlag('RECURRING_VISIT_COLLECTION_READS', true),

  /** Write visit mutations to RecurringVisit collection. */
  collectionWrites: envFlag('RECURRING_VISIT_COLLECTION_WRITES', true),

  /** Also write embedded schedule[] during migration rollback window. */
  dualWrite: envFlag('RECURRING_VISIT_DUAL_WRITE', false),

  /** Allow reading unmigrated task.schedule[] when collection is empty. */
  legacyFallback: envFlag('RECURRING_VISIT_LEGACY_FALLBACK', true),

  /** Payment sync cooldown on listVisits (sync=false). */
  paymentSyncCooldownMs: Number(process.env.RECURRING_PAYMENT_SYNC_COOLDOWN_MS || 60_000),

  /** Scheduler batch size for overdue payment visits. */
  schedulerBatchSize: Number(process.env.RECURRING_SCHEDULER_BATCH_SIZE || 100),

  /** Max concurrent escrow lookups during payment reconciliation. */
  paymentSyncConcurrency: Number(process.env.RECURRING_PAYMENT_SYNC_CONCURRENCY || 4),
};

/** Statuses counted toward the materialized upcoming visit buffer. */
export const BUFFER_COUNTED_VISIT_STATUSES = [
  'open',
  'reserved',
  'assigned',
  'scheduled',
  'payment_pending',
  'confirmed',
] as const;

export type BufferCountedVisitStatus = (typeof BUFFER_COUNTED_VISIT_STATUSES)[number];

export function isBufferCountedVisitStatus(status: string): boolean {
  return (BUFFER_COUNTED_VISIT_STATUSES as readonly string[]).includes(status);
}
