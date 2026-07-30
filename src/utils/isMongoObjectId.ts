import { NotFoundError } from '../errors/AppError';

const MONGO_OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * Strict Mongo ObjectId check (24 hex).
 * Rejects Book Now escrow placeholders like `booknow-pending-<uuid>`.
 */
export function isMongoObjectId(value: unknown): boolean {
  const id = String(value ?? '').trim();
  return MONGO_OBJECT_ID_RE.test(id);
}

/** True for synthetic Book Now escrow task ids (not real Task documents). */
export function isBookNowPendingTaskId(value: unknown): boolean {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .startsWith('booknow-pending-');
}

/** Throw NotFoundError before Mongoose cast for invalid / placeholder ids. */
export function assertMongoObjectIdTaskId(taskId: unknown): asserts taskId is string {
  const id = String(taskId ?? '').trim();
  if (!isMongoObjectId(id)) {
    throw new NotFoundError('Task not found');
  }
}
