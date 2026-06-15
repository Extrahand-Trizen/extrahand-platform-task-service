import mongoose from "mongoose";
import Task, { ITask } from "../models/Task";
import {
  buildAssignTaskFilter,
  buildAssignTaskUpdate,
} from "./pipelines/taskAssignmentPipeline";
import {
  buildAtomicReviseBudgetFilter,
  buildAtomicReviseBudgetUpdatePipeline,
} from "./pipelines/taskBudgetRevisionPipeline";

/**
 * TaskRepository
 *
 * All MongoDB operations for the Task collection.
 * No business logic — only DB read/write operations.
 * All reads use .lean() + .select() for minimal memory overhead.
 */
export class TaskRepository {
  /**
   * Find a task by ID with optional field projection.
   * Returns a lean plain object — callers must not call .save() on the result.
   */
  static async findById(
    id: string,
    fields?: string
  ): Promise<ITask | null> {
    return Task.findById(id)
      .select(fields ?? "")
      .lean() as unknown as ITask | null;
  }

  /**
   * Atomic budget revision using an aggregation pipeline update.
   * Single round trip. Guards:
   *   - poster must own the task (requesterId match)
   *   - task must be in 'open' status
   *   - currentRevisionRound must be < MAX_REVISION_ROUNDS
   *   - newAmount must differ from current budget.amount
   *
   * Returns the updated task document (new: true), or null if any guard fails.
   */
  static async atomicReviseBudget(input: {
    taskId: string;
    actorProfileId: mongoose.Types.ObjectId;
    newAmount: number;
  }): Promise<ITask | null> {
    const { taskId, actorProfileId, newAmount } = input;

    return Task.findOneAndUpdate(
      buildAtomicReviseBudgetFilter({ taskId, actorProfileId, newAmount }),
      buildAtomicReviseBudgetUpdatePipeline({ newAmount, actorProfileId }),
      { new: true }
    ).lean() as unknown as ITask | null;
  }

  /**
   * Update the notifiedBidderCount on the latest budgetRevision entry
   * after the notification batch has been dispatched.
   * Called non-blocking (fire-and-forget) from BudgetRevisionService.
   */
  static async updateLatestRevisionNotifiedCount(
    taskId: string,
    round: number,
    count: number
  ): Promise<void> {
    await Task.updateOne(
      { _id: taskId, "budgetRevisions.round": round },
      { $set: { "budgetRevisions.$.notifiedBidderCount": count } }
    );
  }

  /**
   * Atomic task assignment — concurrency-safe.
   * Only assigns if the task is still in 'open' status.
   * Returns the updated task, or null if the task was already taken.
   */
  static async assignTask(input: {
    taskId: string;
    assigneeId: mongoose.Types.ObjectId;
    assignedAt?: Date;
  }): Promise<ITask | null> {
    const { taskId, assigneeId, assignedAt } = input;

    return Task.findOneAndUpdate(
      buildAssignTaskFilter(taskId),
      buildAssignTaskUpdate({ taskId, assigneeId, assignedAt }),
      { new: true }
    ).lean() as unknown as ITask | null;
  }
}
