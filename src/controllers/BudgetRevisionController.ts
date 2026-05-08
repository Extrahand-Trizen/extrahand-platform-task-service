import { Response } from "express";
import { AuthenticatedRequest } from "../types";
import { BudgetRevisionService } from "../services/BudgetRevisionService";
import { ApiResponse } from "../utils/ApiResponse";
import { BadRequestError } from "../errors/AppError";

/**
 * BudgetRevisionController
 *
 * Thin HTTP layer for the Global Budget Revision model.
 * Only responsibilities:
 *   1. Parse & validate HTTP request shape
 *   2. Delegate to BudgetRevisionService
 *   3. Send HTTP response
 *
 * No business logic here.
 */
export class BudgetRevisionController {
  /**
   * POST /api/v1/tasks/:taskId/revise-budget
   *
   * Poster revises the task budget globally (max 2 times).
   * Body: { newAmount: number, reason?: string }
   */
  static async reviseBudget(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user?.profileId) {
      throw new BadRequestError("Profile not found. Please complete onboarding.");
    }

    const { newAmount, reason } = req.body;

    if (newAmount === undefined || newAmount === null) {
      throw new BadRequestError("newAmount is required");
    }

    const updatedTask = await BudgetRevisionService.reviseBudget({
      taskId: req.params.taskId,
      actorProfileId: req.user.profileId,
      actorUid: req.user.uid,
      newAmount: Number(newAmount),
      reason: reason ? String(reason).trim() : undefined,
    });

    ApiResponse.success(res, updatedTask, "Budget revised successfully");
  }

  /**
   * POST /api/v1/applications/:id/respond-to-revision
   *
   * Tasker responds to the active global revision round.
   * Body: { action: "keep" | "revise" | "withdraw", newAmount?: number }
   */
  static async respondToRevision(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    if (!req.user?.profileId) {
      throw new BadRequestError("Profile not found. Please complete onboarding.");
    }

    const { action, newAmount } = req.body;

    const VALID_ACTIONS = ["keep", "revise", "withdraw"];
    if (!action || !VALID_ACTIONS.includes(action)) {
      throw new BadRequestError(
        `action must be one of: ${VALID_ACTIONS.join(", ")}`
      );
    }

    const updatedApplication = await BudgetRevisionService.respondToRevision({
      applicationId: req.params.id,
      actorProfileId: req.user.profileId,
      action: action as "keep" | "revise" | "withdraw",
      newAmount: newAmount !== undefined ? Number(newAmount) : undefined,
    });

    ApiResponse.success(
      res,
      updatedApplication,
      "Revision response submitted successfully"
    );
  }
}
