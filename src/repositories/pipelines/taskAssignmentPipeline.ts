import mongoose from "mongoose";

export interface AssignTaskPipelineInput {
  taskId: string;
  assigneeId: mongoose.Types.ObjectId;
  assignedAt?: Date;
}

/** Filter: task must still be open (concurrency guard). */
export function buildAssignTaskFilter(taskId: string) {
  return {
    _id: taskId,
    status: "open" as const,
  };
}

/** Atomic assignment update — closes negotiation and sets assignee. */
export function buildAssignTaskUpdate(input: AssignTaskPipelineInput) {
  const { assigneeId, assignedAt = new Date() } = input;

  return {
    $set: {
      status: "assigned" as const,
      negotiationStatus: "closed" as const,
      assigneeId,
      assignedAt,
    },
  };
}
