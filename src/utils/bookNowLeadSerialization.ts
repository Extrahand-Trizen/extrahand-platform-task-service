import { summarizeProjectExecution } from './projectExecution';

export function serializeBookNowLeadExecutionFields(task: Record<string, unknown>) {
  const consultationState = task.consultationState as Record<string, unknown> | undefined;
  const projectExecution = task.projectExecution as Record<string, unknown> | undefined;

  return {
    executionPhase: task.executionPhase,
    arrivedAt: task.arrivedAt,
    onTheWayAt: task.onTheWayAt,
    bookingKind: task.bookingKind,
    serviceFlowType: task.serviceFlowType,
    serviceType: task.serviceType,
    consultationState: consultationState
      ? {
          sourceTaskId: consultationState.sourceTaskId,
          projectTaskId: consultationState.projectTaskId,
          currentStage: consultationState.currentStage,
          consultationFee: consultationState.consultationFee,
        }
      : undefined,
    projectExecution: summarizeProjectExecution(
      projectExecution as Parameters<typeof summarizeProjectExecution>[0],
    ),
  };
}
