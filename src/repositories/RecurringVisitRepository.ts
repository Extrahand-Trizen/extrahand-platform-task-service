import mongoose from 'mongoose';
import RecurringVisit, { type IRecurringVisit } from '../models/RecurringVisit';
import {
  BUFFER_COUNTED_VISIT_STATUSES,
  isBufferCountedVisitStatus,
} from '../config/recurringVisitConfig';

export type RecurringVisitDoc = IRecurringVisit;
export type RecurringVisitLean = Omit<IRecurringVisit, keyof mongoose.Document> & {
  _id: mongoose.Types.ObjectId;
};

export type RecurringVisitUpsertInput = Partial<IRecurringVisit> & {
  parentTaskId: mongoose.Types.ObjectId;
  visitId: string;
  visitIndex: number;
  date: Date;
  status: IRecurringVisit['status'];
  paymentStatus: IRecurringVisit['paymentStatus'];
};

const DEFAULT_LIST_SELECT =
  'parentTaskId visitId visitIndex date scheduledTimeStart scheduledTimeEnd expectedDurationMinutes status paymentStatus escrowId paymentDeadline paidAt amount assigneeId assigneeUid childTaskId skippedAt skippedBy skipReason paymentReminderSentAt cancellationChargeAmount rescheduleRequest cancelRequest createdAt updatedAt';

function toObjectId(id: string | mongoose.Types.ObjectId): mongoose.Types.ObjectId {
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}

export class RecurringVisitRepository {
  static async createVisit(input: RecurringVisitUpsertInput): Promise<RecurringVisitLean> {
    const doc = await RecurringVisit.create(input);
    return doc.toObject() as RecurringVisitLean;
  }

  static async createVisits(inputs: RecurringVisitUpsertInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await RecurringVisit.insertMany(inputs, { ordered: false });
    return result.length;
  }

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

  static async findByVisitId(visitId: string): Promise<RecurringVisitLean | null> {
    return RecurringVisit.findOne({ visitId: visitId.trim() })
      .select(DEFAULT_LIST_SELECT)
      .lean() as Promise<RecurringVisitLean | null>;
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

  static async findByParentAndIndex(
    parentTaskId: string | mongoose.Types.ObjectId,
    visitIndex: number,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisit.findOne({
      parentTaskId: toObjectId(parentTaskId),
      visitIndex,
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

  /**
   * Work Details carousel: previous + current + upcoming only.
   * Uses indexed parentTaskId / status / visitIndex queries instead of loading the full plan.
   */
  static async listWorkDetailsPreview(
    parentTaskId: string | mongoose.Types.ObjectId,
    activeVisitId?: string | null,
  ): Promise<{
    previewVisits: RecurringVisitLean[];
    totalListed: number;
    hiddenCount: number;
  }> {
    const parentOid = toObjectId(parentTaskId);
    const totalListed = await RecurringVisit.countDocuments({ parentTaskId: parentOid });
    if (totalListed === 0) {
      return { previewVisits: [], totalListed: 0, hiddenCount: 0 };
    }

    const terminalStatuses = [
      'completed',
      'cancelled',
      'skipped',
      'skipped_unpaid',
      'cancelled_late',
    ];

    let current: RecurringVisitLean | null = null;
    const activeId = String(activeVisitId || '').trim();
    if (activeId) {
      current = await RecurringVisitRepository.findByParentAndVisitId(parentOid, activeId);
    }
    if (!current) {
      current = (await RecurringVisit.findOne({
        parentTaskId: parentOid,
        status: { $nin: terminalStatuses },
      })
        .select(DEFAULT_LIST_SELECT)
        .sort({ visitIndex: 1, date: 1 })
        .lean()) as RecurringVisitLean | null;
    }
    if (!current) {
      current = (await RecurringVisit.findOne({ parentTaskId: parentOid })
        .select(DEFAULT_LIST_SELECT)
        .sort({ visitIndex: -1, date: -1 })
        .lean()) as RecurringVisitLean | null;
    }
    if (!current) {
      return { previewVisits: [], totalListed, hiddenCount: totalListed };
    }

    let previous = (await RecurringVisit.findOne({
      parentTaskId: parentOid,
      status: 'completed',
    })
      .select(DEFAULT_LIST_SELECT)
      .sort({ visitIndex: -1, date: -1 })
      .lean()) as RecurringVisitLean | null;

    if (!previous && current.visitIndex > 1) {
      previous = (await RecurringVisit.findOne({
        parentTaskId: parentOid,
        visitIndex: { $lt: current.visitIndex },
      })
        .select(DEFAULT_LIST_SELECT)
        .sort({ visitIndex: -1 })
        .lean()) as RecurringVisitLean | null;
    }

    if (previous && previous.visitId === current.visitId) {
      previous = null;
    }

    const upcoming = (await RecurringVisit.findOne({
      parentTaskId: parentOid,
      visitIndex: { $gt: current.visitIndex },
      status: { $nin: terminalStatuses },
    })
      .select(DEFAULT_LIST_SELECT)
      .sort({ visitIndex: 1, date: 1 })
      .lean()) as RecurringVisitLean | null;

    const selected: RecurringVisitLean[] = [];
    const seen = new Set<string>();
    for (const row of [previous, current, upcoming]) {
      if (!row) continue;
      const key = String(row.visitId || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      selected.push(row);
    }

    selected.sort((a, b) => {
      const ai = Number(a.visitIndex) || 0;
      const bi = Number(b.visitIndex) || 0;
      if (ai !== bi) return ai - bi;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return {
      previewVisits: selected,
      totalListed,
      hiddenCount: Math.max(0, totalListed - selected.length),
    };
  }

  static async listUpcoming(
    parentTaskId: string | mongoose.Types.ObjectId,
    limit?: number,
  ): Promise<RecurringVisitLean[]> {
    const q = RecurringVisit.find({
      parentTaskId: toObjectId(parentTaskId),
      status: { $in: [...BUFFER_COUNTED_VISIT_STATUSES] },
    })
      .select(DEFAULT_LIST_SELECT)
      .sort({ date: 1, visitIndex: 1 });
    if (limit) q.limit(limit);
    return q.lean() as Promise<RecurringVisitLean[]>;
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

  static async updateVisitStatus(
    parentTaskId: string | mongoose.Types.ObjectId,
    visitId: string,
    status: IRecurringVisit['status'],
    extra?: Partial<IRecurringVisit>,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisitRepository.updateVisit(parentTaskId, visitId, {
      $set: { status, ...extra },
    });
  }

  static async updatePaymentState(
    parentTaskId: string | mongoose.Types.ObjectId,
    visitId: string,
    fields: Pick<
      Partial<IRecurringVisit>,
      | 'paymentStatus'
      | 'escrowId'
      | 'paidAt'
      | 'amount'
      | 'paymentDeadline'
      | 'status'
    >,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisitRepository.updateVisit(parentTaskId, visitId, { $set: fields });
  }

  static async linkChildTask(
    parentTaskId: string | mongoose.Types.ObjectId,
    visitId: string,
    childTaskId: mongoose.Types.ObjectId,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisitRepository.updateVisit(parentTaskId, visitId, {
      $set: { childTaskId },
    });
  }

  static async unlinkChildTask(
    parentTaskId: string | mongoose.Types.ObjectId,
    visitId: string,
  ): Promise<RecurringVisitLean | null> {
    return RecurringVisitRepository.updateVisit(parentTaskId, visitId, {
      $set: { childTaskId: null },
    });
  }

  static async deleteByParentTaskId(
    parentTaskId: string | mongoose.Types.ObjectId,
  ): Promise<number> {
    const result = await RecurringVisit.deleteMany({ parentTaskId: toObjectId(parentTaskId) });
    return result.deletedCount ?? 0;
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

  static async getPlanStatusCounts(parentTaskId: string | mongoose.Types.ObjectId): Promise<
    Record<string, number>
  > {
    const rows = await RecurringVisit.aggregate<{ _id: string; count: number }>([
      { $match: { parentTaskId: toObjectId(parentTaskId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row._id] = row.count;
    }
    return out;
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

  static isBufferCountedStatus(status: string): boolean {
    return isBufferCountedVisitStatus(status);
  }
}
