import mongoose from 'mongoose';
import RecurringVisit, { type IRecurringVisit } from '../models/RecurringVisit';
import { BUFFER_COUNTED_VISIT_STATUSES } from '../config/recurringVisitConfig';

export type RecurringVisitDoc = IRecurringVisit;
export type RecurringVisitLean = Omit<IRecurringVisit, keyof mongoose.Document> & {
  _id: mongoose.Types.ObjectId;
};

export type RecurringVisitUpsertInput = Partial<IRecurringVisit> & {
  parentTaskId?: mongoose.Types.ObjectId;
  visitId: string;
  visitIndex: number;
  date: Date;
  status: IRecurringVisit['status'];
  paymentStatus: IRecurringVisit['paymentStatus'];
};

const DEFAULT_LIST_SELECT =
  'parentTaskId planId serviceType visitId visitIndex date scheduledAt scheduledTimeStart scheduledTimeEnd expectedDurationMinutes status paymentStatus escrowId paymentDeadline paidAt amount assigneeId assigneeUid childTaskId bookingOrderId priceSnapshot paymentOpenedAt skippedAt skippedBy skipReason paymentReminderSentAt cancellationChargeAmount rescheduleRequest cancelRequest createdAt updatedAt';

function toObjectId(id: string | mongoose.Types.ObjectId): mongoose.Types.ObjectId {
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}

export class RecurringVisitRepository {
  static async upsertVisits(inputs: RecurringVisitUpsertInput[]): Promise<{ upserted: number }> {
    if (inputs.length === 0) return { upserted: 0 };

    const ops = inputs.map((row) => ({
      updateOne: {
        filter: { parentTaskId: row.parentTaskId, visitId: row.visitId },
        update: {
          $set: {
            ...row,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: row.createdAt ?? new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await RecurringVisit.bulkWrite(ops, { ordered: false });
    return {
      upserted: (result.upsertedCount || 0) + (result.modifiedCount || 0),
    };
  }

  /**
   * Optimistic single-visit write: applies only when the row still carries the `updatedAt`
   * it was read with. Returns false when another writer changed the visit first.
   */
  static async updateVisitIfUnchanged(
    parentTaskId: mongoose.Types.ObjectId,
    visitId: string,
    expectedUpdatedAt: Date | null,
    fields: Record<string, unknown>,
    unsetFields: string[],
    updatedAt: Date,
  ): Promise<boolean> {
    const update: Record<string, unknown> = { $set: { ...fields, updatedAt } };
    if (unsetFields.length > 0) {
      update.$unset = Object.fromEntries(unsetFields.map((key) => [key, '']));
    }
    const result = await RecurringVisit.updateOne(
      { parentTaskId, visitId, updatedAt: expectedUpdatedAt },
      update,
      { timestamps: false },
    );
    return (result.matchedCount ?? 0) > 0;
  }

  /** Insert-only upsert: never overwrites a visit that already exists. */
  static async insertVisitsIfMissing(inputs: RecurringVisitUpsertInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const now = new Date();
    await RecurringVisit.bulkWrite(
      inputs.map((row) => ({
        updateOne: {
          filter: { parentTaskId: row.parentTaskId, visitId: row.visitId },
          update: {
            $setOnInsert: {
              ...row,
              createdAt: row.createdAt ?? now,
              updatedAt: now,
            },
          },
          upsert: true,
          timestamps: false,
        },
      })),
      { ordered: false },
    );
  }

  static async listByParentAndVisitIds(
    parentTaskId: mongoose.Types.ObjectId,
    visitIds: string[],
  ): Promise<RecurringVisitLean[]> {
    if (visitIds.length === 0) return [];
    return RecurringVisit.find({ parentTaskId, visitId: { $in: visitIds } })
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean[]>;
  }

  static async findByParentAndVisitId(
    parentTaskId: string | mongoose.Types.ObjectId,
    visitId: string,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisit.findOne({
      parentTaskId: toObjectId(parentTaskId),
      visitId: visitId.trim(),
    })
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean | null>;
  }

  static async listByParent(
    parentTaskId: string | mongoose.Types.ObjectId,
    options?: { select?: string },
  ): Promise<RecurringVisitLean[]> {
    return RecurringVisit.find({ parentTaskId: toObjectId(parentTaskId) })
      .select(options?.select || DEFAULT_LIST_SELECT)
      .sort({ visitIndex: 1, date: 1 })
      .lean() as Promise<RecurringVisitLean[]>;
  }

  static async listPaymentPending(
    parentTaskId: string | mongoose.Types.ObjectId,
  ): Promise<RecurringVisitLean[]> {
    return RecurringVisit.find({
      parentTaskId: toObjectId(parentTaskId),
      status: 'payment_pending',
    })
      .select(DEFAULT_LIST_SELECT)
      .sort({ date: 1, visitIndex: 1 })
      .lean() as Promise<RecurringVisitLean[]>;
  }

  static async countUpcoming(parentTaskId: string | mongoose.Types.ObjectId): Promise<number> {
    return RecurringVisit.countDocuments({
      parentTaskId: toObjectId(parentTaskId),
      status: { $in: [...BUFFER_COUNTED_VISIT_STATUSES] },
    });
  }

  static async countByParent(parentTaskId: string | mongoose.Types.ObjectId): Promise<number> {
    return RecurringVisit.countDocuments({ parentTaskId: toObjectId(parentTaskId) });
  }

  static async hasCollectionVisits(
    parentTaskId: string | mongoose.Types.ObjectId,
  ): Promise<boolean> {
    const one = await RecurringVisit.findOne({ parentTaskId: toObjectId(parentTaskId) })
      .select('_id')
      .lean();
    return Boolean(one);
  }

  static async findOverduePaymentPending(options?: {
    limit?: number;
    now?: Date;
  }): Promise<RecurringVisitLean[]> {
    const now = options?.now ?? new Date();
    const q = RecurringVisit.find({
      status: 'payment_pending',
      paymentDeadline: { $lte: now },
      serviceType: { $ne: 'book_now' },
    })
      .select(DEFAULT_LIST_SELECT)
      .sort({ paymentDeadline: 1 })
      .limit(options?.limit ?? 100);
    return q.lean() as Promise<RecurringVisitLean[]>;
  }

  static async updateVisit(
    parentTaskId: string | mongoose.Types.ObjectId,
    visitId: string,
    update: mongoose.UpdateQuery<IRecurringVisit>,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisit.findOneAndUpdate(
      { parentTaskId: toObjectId(parentTaskId), visitId: visitId.trim() },
      { ...update, $set: { ...(update.$set as object), updatedAt: new Date() } },
      { new: true },
    )
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean | null>;
  }

  static async getMaximumVisitIndex(
    parentTaskId: string | mongoose.Types.ObjectId,
  ): Promise<number> {
    const row = await RecurringVisit.findOne({ parentTaskId: toObjectId(parentTaskId) })
      .sort({ visitIndex: -1 })
      .select('visitIndex')
      .lean();
    return row?.visitIndex ?? 0;
  }

  static async getLastMaterializedVisit(
    parentTaskId: string | mongoose.Types.ObjectId,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisit.findOne({ parentTaskId: toObjectId(parentTaskId) })
      .sort({ visitIndex: -1, date: -1 })
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean | null>;
  }

  static async listByPlanId(
    planId: string | mongoose.Types.ObjectId,
    options?: { select?: string },
  ): Promise<RecurringVisitLean[]> {
    return RecurringVisit.find({ planId: toObjectId(planId) })
      .select(options?.select || DEFAULT_LIST_SELECT)
      .sort({ visitIndex: 1, date: 1 })
      .lean() as Promise<RecurringVisitLean[]>;
  }

  static async findByMongoId(id: string | mongoose.Types.ObjectId): Promise<RecurringVisitLean | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return RecurringVisit.findById(id)
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean | null>;
  }

  static async findByPlanAndVisitId(
    planId: string | mongoose.Types.ObjectId,
    visitId: string,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisit.findOne({ planId: toObjectId(planId), visitId: visitId.trim() })
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean | null>;
  }

  static async findBookNowPaymentOpenOverdue(options?: {
    limit?: number;
    now?: Date;
  }): Promise<RecurringVisitLean[]> {
    const now = options?.now ?? new Date();
    return RecurringVisit.find({
      serviceType: 'book_now',
      status: 'payment_pending',
      paymentDeadline: { $lte: now },
    })
      .select(DEFAULT_LIST_SELECT)
      .sort({ paymentDeadline: 1 })
      .limit(options?.limit ?? 100)
      .lean() as Promise<RecurringVisitLean[]>;
  }

  static async findBookNowScheduledForPaymentOpen(options?: {
    limit?: number;
    openBefore?: Date;
  }): Promise<RecurringVisitLean[]> {
    const openBefore = options?.openBefore ?? new Date();
    return RecurringVisit.find({
      serviceType: 'book_now',
      status: 'scheduled',
      scheduledAt: { $lte: openBefore },
      bookingOrderId: { $in: [null, undefined] },
    })
      .select(DEFAULT_LIST_SELECT)
      .sort({ scheduledAt: 1 })
      .limit(options?.limit ?? 100)
      .lean() as Promise<RecurringVisitLean[]>;
  }

  static async claimVisitStatus(params: {
    planId: mongoose.Types.ObjectId;
    visitId: string;
    fromStatus: string;
    toStatus: string;
    extraSet?: Record<string, unknown>;
  }): Promise<RecurringVisitLean | null> {
    return RecurringVisit.findOneAndUpdate(
      {
        planId: params.planId,
        visitId: params.visitId,
        status: params.fromStatus,
      },
      { $set: { status: params.toStatus, updatedAt: new Date(), ...(params.extraSet || {}) } },
      { new: true },
    )
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean | null>;
  }

  static async listChildTaskIds(parentTaskId: string | mongoose.Types.ObjectId): Promise<string[]> {
    const rows = await RecurringVisit.find({
      parentTaskId: toObjectId(parentTaskId),
      childTaskId: { $exists: true, $ne: null },
    })
      .select('childTaskId')
      .lean();
    return rows
      .map((r) => (r.childTaskId ? String(r.childTaskId) : ''))
      .filter(Boolean);
  }
}
