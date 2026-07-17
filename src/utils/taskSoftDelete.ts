/**
 * Composite index helper note for soft-delete list queries.
 * Mongoose schema defaults (`isDeletedByCustomer: false`) apply to new documents.
 * Existing documents without the field are treated as not deleted via `{ $ne: true }`.
 *
 * Optional ops backfill (run manually if desired):
 *   db.tasks.updateMany(
 *     { isDeletedByCustomer: { $exists: false } },
 *     { $set: { isDeletedByCustomer: false } }
 *   )
 *   db.bookingorders.updateMany(
 *     { isDeletedByCustomer: { $exists: false } },
 *     { $set: { isDeletedByCustomer: false } }
 *   )
 */

export const TASK_SOFT_DELETE_QUERY = { isDeletedByCustomer: { $ne: true } } as const;
