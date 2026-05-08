import mongoose from "mongoose";
import TaskApplication, { ITaskApplication } from "../models/TaskApplication";

/**
 * ApplicationRepository
 *
 * All MongoDB operations for the TaskApplication collection.
 * No business logic — only DB read/write operations.
 * All reads use .lean() + .select() for minimal memory overhead.
 */
export class ApplicationRepository {
  /**
   * Find an application by ID with optional field projection.
   * Returns a lean plain object.
   */
  static async findById(
    id: string,
    fields?: string
  ): Promise<ITaskApplication | null> {
    return TaskApplication.findById(id)
      .select(fields ?? "")
      .lean() as unknown as ITaskApplication | null;
  }

  /**
   * Covered index query — returns only applicantUid for all pending
   * applications on a task. Pure index scan (no document page reads)
   * when the { taskId, status, applicantUid } compound index exists.
   *
   * Used by BudgetRevisionService to build the notification recipient list.
   */
  static async getPendingBidderUids(taskId: string): Promise<string[]> {
    const results = await TaskApplication.find(
      { taskId, status: "pending" },
      { applicantUid: 1, _id: 0 } // projection: covered by task_status_uid_covered index
    ).lean();
    return results.map((r: any) => r.applicantUid as string);
  }

  /**
   * Bulk-set taskCurrentRevisionRound on all pending applications for a task.
   * Called during revise-budget to denormalize the round number so
   * respond-to-revision doesn't need a separate task read.
   * O(A) bulk write — one DB op regardless of bidder count.
   */
  static async setTaskRevisionRound(
    taskId: string,
    round: number
  ): Promise<void> {
    await TaskApplication.updateMany(
      { taskId, status: "pending" },
      { $set: { taskCurrentRevisionRound: round } }
    );
  }

  /**
   * Apply a tasker's response to a global revision round (keep or revise).
   * Atomically updates:
   *   - proposedBudget.amount (to newAmount)
   *   - respondedToRevisionRound (marks this round as responded)
   *   - appends entry to quotationRevisions[]
   *
   * Returns updated application, or null if the write was a no-op
   * (e.g. application no longer pending or concurrency conflict).
   */
  static async applyRevisionResponse(
    applicationId: string,
    payload: {
      newAmount: number;
      respondedToRevisionRound: number;
      revisionEntry: {
        round: number;
        previousAmount: number;
        newAmount: number;
        revisedAt: Date;
        action: "revised" | "kept" | "withdrawn";
      };
    }
  ): Promise<ITaskApplication | null> {
    return TaskApplication.findOneAndUpdate(
      { _id: applicationId, status: "pending" },
      {
        $set: {
          "proposedBudget.amount": payload.newAmount,
          respondedToRevisionRound: payload.respondedToRevisionRound,
        },
        $push: { quotationRevisions: payload.revisionEntry },
      },
      { new: true }
    ).lean() as unknown as ITaskApplication | null;
  }

  /**
   * Bulk-reject all pending applications for a task except the accepted one.
   * O(A) bulk write — one DB operation.
   */
  static async rejectAllExcept(
    taskId: string,
    acceptedApplicationId: string
  ): Promise<void> {
    await TaskApplication.updateMany(
      {
        taskId,
        _id: { $ne: new mongoose.Types.ObjectId(acceptedApplicationId) },
        status: "pending",
      },
      { $set: { status: "rejected" } }
    );
  }

  /**
   * Mark a single application as accepted.
   */
  static async markAccepted(
    applicationId: string
  ): Promise<ITaskApplication | null> {
    return TaskApplication.findByIdAndUpdate(
      applicationId,
      { $set: { status: "accepted", respondedAt: new Date() } },
      { new: true }
    ).lean() as unknown as ITaskApplication | null;
  }
}
