import type { ITask } from '../models/Task';

/**
 * Slim create-task payload for HTTP responses.
 * Large embedded schedule arrays can add seconds to serialize/transfer.
 */
export function buildCreateTaskApiResponse(
  task: ITask | Record<string, unknown>,
): Record<string, unknown> {
  const response = { ...(task as Record<string, unknown>) };
  const schedule = response.schedule;
  if (Array.isArray(schedule) && schedule.length > 0) {
    response.scheduleCount = schedule.length;
    delete response.schedule;
  }
  return response;
}
