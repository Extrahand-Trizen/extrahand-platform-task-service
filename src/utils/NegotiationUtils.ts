import { BadRequestError } from "../errors/AppError";

/**
 * NegotiationUtils
 *
 * Pure, stateless utility functions for the Global Budget Revision model.
 * No DB calls. No external service calls. No side effects.
 * All business constants for the negotiation system are defined here so
 * changing the limits (e.g. MAX_REVISION_ROUNDS) requires editing one file.
 */

export const NegotiationUtils = {
  /** Maximum number of times a poster can revise the listed budget (negotiable tasks). */
  MAX_REVISION_ROUNDS: 1 as const,
  /** Minimum allowed quote/revision amount in INR. */
  MIN_AMOUNT: 50 as const,
  /** Maximum allowed quote/revision amount in INR. */
  MAX_AMOUNT: 50_000 as const,

  /**
   * Validates that a revision or quote amount is a positive integer
   * within the allowed range.
   * Throws BadRequestError with a user-friendly message if invalid.
   * Returns the validated number on success.
   */
  validateAmount(amount: unknown): number {
    const raw = Number(amount);
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new BadRequestError("Amount must be a positive whole number");
    }
    if (raw < NegotiationUtils.MIN_AMOUNT) {
      throw new BadRequestError(`Amount must be at least ₹${NegotiationUtils.MIN_AMOUNT}`);
    }
    if (raw > NegotiationUtils.MAX_AMOUNT) {
      throw new BadRequestError(`Amount cannot exceed ₹${NegotiationUtils.MAX_AMOUNT}`);
    }
    return raw;
  },

  /**
   * Returns true if the poster can still revise the task budget.
   * (i.e. they haven't used up all allowed revision rounds)
   */
  canRevise(currentRevisionRound: number): boolean {
    return currentRevisionRound < NegotiationUtils.MAX_REVISION_ROUNDS;
  },

  /**
   * Returns true if the tasker has already responded to the current round.
   * Guard: prevent double-response in the same round.
   */
  hasRespondedToCurrentRound(
    respondedToRevisionRound: number | null | undefined,
    taskCurrentRevisionRound: number
  ): boolean {
    return (respondedToRevisionRound ?? 0) >= taskCurrentRevisionRound;
  },

  /**
   * Builds the payload for ApplicationRepository.applyRevisionResponse()
   * based on the tasker's chosen action.
   *
   * - action "keep":   proposedBudget.amount stays the same
   * - action "revise": proposedBudget.amount is updated to newAmount
   */
  buildRevisionResponsePayload(input: {
    action: "keep" | "revise";
    newAmount: number;       // for "revise": the new quote; for "keep": ignored (currentAmount used)
    currentAmount: number;   // tasker's current proposedBudget.amount
    round: number;           // task.currentRevisionRound
  }): {
    newAmount: number;
    respondedToRevisionRound: number;
    revisionEntry: {
      round: number;
      previousAmount: number;
      newAmount: number;
      revisedAt: Date;
      action: "revised" | "kept" | "withdrawn";
    };
  } {
    const effectiveNewAmount =
      input.action === "revise" ? input.newAmount : input.currentAmount;

    return {
      newAmount: effectiveNewAmount,
      respondedToRevisionRound: input.round,
      revisionEntry: {
        round: input.round,
        previousAmount: input.currentAmount,
        newAmount: effectiveNewAmount,
        revisedAt: new Date(),
        action: input.action === "revise" ? "revised" : "kept",
      },
    };
  },
} as const;
