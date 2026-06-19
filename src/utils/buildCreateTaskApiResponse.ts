import type { ITask } from '../models/Task';

/**
 * Slim create-task payload for HTTP responses.
 * Large embedded schedule arrays can add seconds to serialize/transfer.
 */
export function buildCreateTaskApiResponse(task: ITask): ITask {
  const plain = { ...(task as unknown as ITask & { scheduleCount?: number }) };

  if (Array.isArray(plain.schedule) && plain.schedule.length > 0) {
    const scheduleCount = plain.schedule.length;
    const { schedule: _schedule, ...rest } = plain;
    return { ...rest, scheduleCount } as unknown as ITask;
  }

  return plain as unknown as ITask;
}
