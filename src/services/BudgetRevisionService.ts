import mongoose from "mongoose";
import logger from "../config/logger";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from "../errors/AppError";
import { TaskRepository } from "../repositories/TaskRepository";
import { ApplicationRepository } from "../repositories/ApplicationRepository";
import { NegotiationUtils } from "../utils/NegotiationUtils";
import { ProfileUtils } from "../utils/ProfileUtils";
import { NotificationClient } from "./NotificationClient";
import { InAppNotificationClient } from "../clients/InAppNotificationClient";
import { TaskService } from "./TaskService";
import { ITask } from "../models/Task";
import { ITaskApplication } from "../models/TaskApplication";

/**
 * BudgetRevisionService
 *
 * Business logic for the Global Counter Offer Model.
 * Responsible for:
 *   1. reviseBudget()      — Poster revises the task budget globally (max 2 rounds)
 *   2. respondToRevision() — Tasker responds to an active revision round (keep/revise/withdraw)
 *
 * All DB operations delegate to TaskRepository / ApplicationRepository.
 * All validation delegates to NegotiationUtils.
 * All profile lookups delegate to ProfileUtils.
 * Notifications are dispatched asynchronously (non-blocking).
 */
export class BudgetRevisionService {
  /**
   * POST /tasks/:taskId/revise-budget
   *
   * Poster revises the task budget globally.
   * - Validates poster owns the task and revision is allowed
   * - Atomically updates task.budget.amount, currentRevisionRound, budgetRevisions[]
   * - Denormalizes round onto all pending applications (bulk write)
   * - Dispatches TASK_BUDGET_REVISED notifications to all pending bidders (non-blocking)
   *
   * @returns The updated task document
   */
  static async reviseBudget(input: {
    taskId: string;
    actorProfileId: mongoose.Types.ObjectId;
    actorUid: string;
    newAmount: number;
    reason?: string;
  }): Promise<ITask> {
    const { taskId, actorProfileId, actorUid, newAmount } = input;

    // ── VALIDATE AMOUNT ──────────────────────────────────────────────────────
    NegotiationUtils.validateAmount(newAmount);

    // ── ATOMIC DB WRITE ──────────────────────────────────────────────────────
    // Single round trip. Guards: ownership, status:'open', round<2, amount differs.
    const updated = await TaskRepository.atomicReviseBudget({
      taskId,
      actorProfileId,
      newAmount,
    });

    if (!updated) {
      // Determine why the update failed to give a clear error message.
      const task = await TaskRepository.findById(
        taskId,
        "status requesterId currentRevisionRound budget"
      );
      if (!task) throw new NotFoundError("Task not found");
      if (!task.requesterId.equals(actorProfileId)) {
        throw new ForbiddenError("Only the task poster can revise the budget");
      }
      if (task.status !== "open") {
        throw new BadRequestError(
          "Budget can only be revised while the task is open"
        );
      }
      if (!NegotiationUtils.canRevise(task.currentRevisionRound)) {
        throw new BadRequestError(
          `Budget can only be revised ${NegotiationUtils.MAX_REVISION_ROUNDS} times. ` +
            `Please accept an offer or cancel the task.`
        );
      }
      if (task.budget.amount === newAmount) {
        throw new BadRequestError(
          "New amount must be different from the current budget"
        );
      }
      // Fallback: shouldn't reach here, but be safe
      throw new ConflictError("Unable to revise budget. Please try again.");
    }

    const round = updated.currentRevisionRound;

    logger.info("[BudgetRevisionService.reviseBudget] Budget revised", {
      taskId,
      round,
      previousAmount: updated.budgetRevisions?.[round - 1]?.previousAmount,
      newAmount,
      actorUid,
    });

    // Drop Redis task detail + browse list cache before returning so poster/helper
    // refetches cannot overwrite the UI with the pre-revision budget/round.
    await TaskService.invalidateTaskCacheAsync(taskId);
    TaskService.invalidateTaskListCache();

    // ── DENORMALIZE ROUND onto pending applications ──────────────────────────
    // Bulk write: O(A) one DB op so respond-to-revision doesn't need a task fetch.
    // Synchronous — must complete before HTTP response so helpers see the update
    // immediately when their frontend refetches after poster's revision.
    try {
      await ApplicationRepository.setTaskRevisionRound(taskId, round);
      logger.info(
        "[BudgetRevisionService.reviseBudget] Denormalized revision round onto applications",
        { taskId, round }
      );
    } catch (err) {
      logger.error(
        "[BudgetRevisionService.reviseBudget] Failed to denormalize round",
        { taskId, round, error: err instanceof Error ? err.message : err }
      );
    }

    // ── DISPATCH NOTIFICATIONS ───────────────────────────────────────────────
    // Fetch pending bidder UIDs via covered index scan (no doc reads), then
    // batch-notify all of them. Non-blocking.
    setImmediate(async () => {
      try {
        const bidderUids = await ApplicationRepository.getPendingBidderUids(taskId);

        if (bidderUids.length === 0) {
          logger.info(
            "[BudgetRevisionService.reviseBudget] No pending bidders to notify",
            { taskId, round }
          );
          return;
        }

        await NotificationClient.sendBatch(
          {
            eventKey: "TASK_BUDGET_REVISED",
            category: "taskUpdates",
            actorId: actorUid,
            entity: { type: "task", id: taskId },
            title: "Budget updated on a task you bid on",
            body: `The budget for this task has been updated to ₹${newAmount.toLocaleString("en-IN")}. Review and keep, revise, or withdraw your offer.`,
            data: {
              taskId,
              newAmount,
              round,
              actionUrl: `/my-offers`,
            },
          },
          bidderUids
        );

        // Update the notified count on the revision audit entry.
        await TaskRepository.updateLatestRevisionNotifiedCount(
          taskId,
          round,
          bidderUids.length
        );

        logger.info(
          "[BudgetRevisionService.reviseBudget] Notifications dispatched",
          { taskId, round, bidderCount: bidderUids.length }
        );
      } catch (err) {
        logger.error(
          "[BudgetRevisionService.reviseBudget] Failed to dispatch notifications",
          { taskId, round, error: err instanceof Error ? err.message : err }
        );
      }
    });

    return updated;
  }

  /**
   * POST /applications/:id/respond-to-revision
   *
   * Tasker responds to an active global budget revision round.
   * Actions:
   *   - "keep":    Acknowledges the revision; keeps current proposedBudget.amount
   *   - "revise":  Updates proposedBudget.amount to a new value (once per round)
   *   - "withdraw": Withdraws the application entirely
   *
   * Guards:
   *   - Caller must own the application
   *   - Application must be pending
   *   - An active revision round must exist (taskCurrentRevisionRound > 0)
   *   - Tasker has not already responded to this round
   *
   * @returns The updated application document
   */
  static async respondToRevision(input: {
    applicationId: string;
    actorProfileId: mongoose.Types.ObjectId;
    action: "keep" | "revise" | "withdraw";
    newAmount?: number;
  }): Promise<ITaskApplication> {
    const { applicationId, actorProfileId, action, newAmount } = input;

    // ── VALIDATE AMOUNT for 'revise' action ──────────────────────────────────
    let validatedAmount: number | undefined;
    if (action === "revise") {
      if (newAmount === undefined) {
        throw new BadRequestError("newAmount is required when action is 'revise'");
      }
      validatedAmount = NegotiationUtils.validateAmount(newAmount);
    }

    // ── FETCH APPLICATION ─────────────────────────────────────────────────────
    const application = await ApplicationRepository.findById(
      applicationId,
      "applicantId status taskId proposedBudget respondedToRevisionRound taskCurrentRevisionRound quotationRevisions"
    );
    if (!application) throw new NotFoundError("Application not found");

    // ── AUTHORIZATION ─────────────────────────────────────────────────────────
    if (!application.applicantId.equals(actorProfileId)) {
      throw new ForbiddenError("Not authorized to respond to this application");
    }

    // ── STATUS CHECK ──────────────────────────────────────────────────────────
    if (application.status !== "pending") {
      throw new BadRequestError("Only pending applications can respond to revisions");
    }

    // ── ACTIVE REVISION CHECK ─────────────────────────────────────────────────
    const taskRevisionRound = application.taskCurrentRevisionRound ?? 0;
    if (taskRevisionRound === 0) {
      throw new BadRequestError(
        "No active budget revision exists for this task"
      );
    }

    // ── ONE-RESPONSE-PER-ROUND GUARD ─────────────────────────────────────────
    if (
      NegotiationUtils.hasRespondedToCurrentRound(
        application.respondedToRevisionRound,
        taskRevisionRound
      )
    ) {
      throw new BadRequestError(
        "You have already responded to this revision round"
      );
    }

    // ── WITHDRAW is a standard withdrawal ────────────────────────────────────
    if (action === "withdraw") {
      await ApplicationRepository.applyRevisionResponse(applicationId, {
        newAmount: application.proposedBudget.amount,
        respondedToRevisionRound: taskRevisionRound,
        revisionEntry: {
          round: taskRevisionRound,
          previousAmount: application.proposedBudget.amount,
          newAmount: application.proposedBudget.amount,
          revisedAt: new Date(),
          action: "withdrawn",
        },
      });
      // Use raw update to set withdrawn status (avoid Mongoose pre-save hook complications)
      const { default: TaskApplication } = await import("../models/TaskApplication");
      const withdrawn = await TaskApplication.findByIdAndUpdate(
        applicationId,
        { $set: { status: "withdrawn", respondedAt: new Date() } },
        { new: true }
      ).lean();

      logger.info("[BudgetRevisionService.respondToRevision] Application withdrawn via revision", {
        applicationId,
        round: taskRevisionRound,
        actorProfileId: actorProfileId.toString(),
      });

      return withdrawn as unknown as ITaskApplication;
    }

    // ── BUILD UPDATE PAYLOAD ─────────────────────────────────────────────────
    const payload = NegotiationUtils.buildRevisionResponsePayload({
      action,
      newAmount: validatedAmount ?? application.proposedBudget.amount,
      currentAmount: application.proposedBudget.amount,
      round: taskRevisionRound,
    });

    // ── WRITE ─────────────────────────────────────────────────────────────────
    const updated = await ApplicationRepository.applyRevisionResponse(
      applicationId,
      payload
    );

    if (!updated) {
      throw new ConflictError("Unable to apply response. Please try again.");
    }

    logger.info("[BudgetRevisionService.respondToRevision] Response applied", {
      applicationId,
      action,
      round: taskRevisionRound,
      previousAmount: application.proposedBudget.amount,
      newAmount: payload.newAmount,
    });

    // ── NOTIFY POSTER (non-blocking) ─────────────────────────────────────────
    setImmediate(async () => {
      try {
        const task = await TaskRepository.findById(
          application.taskId.toString(),
          "requesterId title"
        );
        if (!task) return;

        const posterUid = await ProfileUtils.getUidByProfileId(task.requesterId);
        if (!posterUid) return;

        const actionLabel =
          action === "keep" ? "kept their offer" : `updated their offer to ₹${payload.newAmount.toLocaleString("en-IN")}`;

        // Push notification (poster) - actionable update
        await NotificationClient.send({
          eventKey: "BUDGET_REVISION_RESPONSE",
          category: "taskUpdates",
          actorId: actorProfileId.toString(),
          recipients: [posterUid],
          entity: { type: "application", id: applicationId },
          title: "Offer updated after budget change",
          body: `A bidder has ${actionLabel} on "${task.title}".`,
          data: {
            taskId: application.taskId.toString(),
            applicationId,
            action,
            eventKey: "BUDGET_REVISION_RESPONSE",
          },
        });

        await InAppNotificationClient.send({
          userId: posterUid,
          title: "A bidder responded to your budget revision",
          body: `A bidder has ${actionLabel} on "${task.title}".`,
          category: "taskUpdates",
          type: "info",
          data: {
            taskId: application.taskId.toString(),
            applicationId,
            action,
          },
        });
      } catch (err) {
        logger.warn(
          "[BudgetRevisionService.respondToRevision] Poster notification failed",
          { applicationId, error: err instanceof Error ? err.message : err }
        );
      }
    });

    return updated;
  }
}
