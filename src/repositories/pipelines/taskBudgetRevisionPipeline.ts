import mongoose from "mongoose";
import { NegotiationUtils } from "../../utils/NegotiationUtils";

export interface AtomicReviseBudgetPipelineInput {
  taskId: string;
  actorProfileId: mongoose.Types.ObjectId;
  newAmount: number;
}

/**
 * Filter guards for atomic budget revision:
 * poster ownership, open status, revision cap, and amount must change.
 */
export function buildAtomicReviseBudgetFilter(
  input: AtomicReviseBudgetPipelineInput
) {
  const { taskId, actorProfileId, newAmount } = input;

  return {
    _id: taskId,
    requesterId: actorProfileId,
    status: "open" as const,
    negotiationStatus: { $ne: "closed" as const },
    currentRevisionRound: { $lt: NegotiationUtils.MAX_REVISION_ROUNDS },
    "budget.amount": { $ne: newAmount },
  };
}

/**
 * Aggregation pipeline update (MongoDB 4.2+):
 * references current document fields ($budget.amount, $currentRevisionRound)
 * inside the same update — no separate read required.
 */
export function buildAtomicReviseBudgetUpdatePipeline(input: {
  newAmount: number;
  actorProfileId: mongoose.Types.ObjectId;
}) {
  const { newAmount, actorProfileId } = input;

  return [
    {
      $set: {
        "budget.amount": newAmount,
        negotiationStatus: "revised" as const,
        currentRevisionRound: { $add: ["$currentRevisionRound", 1] },
        budgetRevisions: {
          $concatArrays: [
            { $ifNull: ["$budgetRevisions", []] },
            [
              {
                round: { $add: ["$currentRevisionRound", 1] },
                previousAmount: "$budget.amount",
                newAmount,
                revisedAt: "$$NOW",
                revisedById: actorProfileId,
                notifiedBidderCount: 0,
              },
            ],
          ],
        },
      },
    },
  ];
}
