/**
 * Rules for when a performer is locked into an assigned task (after payment or work started).
 */

import mongoose from 'mongoose';
import Task from '../models/Task';
import { isRecurringVisitPlanTask } from './recurringVisitMeta';

const ACTIVE_ESCROW_STATUSES = new Set(['pending', 'held', 'authorized', 'captured']);

const TASKER_BLOCKING_STATUSES = ['assigned', 'started', 'in_progress', 'review'] as const;

const WORK_IN_FLIGHT_STATUSES = new Set(['started', 'in_progress', 'review']);

export type TaskScheduleFields = {
  scheduledDate?: Date | string | null;
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;
  timeSlot?: string | null;
};

function normalizeDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date
    .getUTCDate()
    .toString()
    .padStart(2, '0')}`;
}

function parseTimeLabelToMinutes(timeLabel: string | null | undefined): number | null {
  const raw = String(timeLabel || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function resolveTimeSlotWindow(timeSlot: string | null | undefined): { start: number; end: number } | null {
  const normalized = String(timeSlot || '').trim().toLowerCase();
  switch (normalized) {
    case 'morning':
      return { start: 8 * 60, end: 11 * 60 };
    case 'midday':
      return { start: 11 * 60, end: 14 * 60 };
    case 'afternoon':
      return { start: 14 * 60, end: 17 * 60 };
    case 'evening':
      return { start: 17 * 60, end: 21 * 60 };
    default:
      return null;
  }
}

function resolveScheduleWindow(task: TaskScheduleFields): { start: number; end: number } | null {
  const start = parseTimeLabelToMinutes(task.scheduledTimeStart);
  if (start !== null) {
    const end = parseTimeLabelToMinutes(task.scheduledTimeEnd);
    return {
      start,
      end: end !== null ? end : start + 60,
    };
  }

  return resolveTimeSlotWindow(task.timeSlot);
}

function taskSchedulesConflict(
  existingTask: TaskScheduleFields,
  candidateTask: TaskScheduleFields
): boolean {
  const existingDate = normalizeDateOnly(existingTask.scheduledDate);
  const candidateDate = normalizeDateOnly(candidateTask.scheduledDate);
  if (!existingDate || !candidateDate || existingDate !== candidateDate) {
    return false;
  }

  const existingWindow = resolveScheduleWindow(existingTask);
  const candidateWindow = resolveScheduleWindow(candidateTask);
  if (!existingWindow || !candidateWindow) {
    return true;
  }

  return (
    existingWindow.start < candidateWindow.end &&
    candidateWindow.start < existingWindow.end
  );
}

export function isActiveEscrow(escrow: { status?: string } | null | undefined): boolean {
  if (!escrow) return false;
  const status = String(escrow.status || '').toLowerCase();
  return ACTIVE_ESCROW_STATUSES.has(status);
}

export function isWorkInFlightStatus(taskStatus: string | undefined | null): boolean {
  return WORK_IN_FLIGHT_STATUSES.has(String(taskStatus || '').toLowerCase());
}

export function canWithdrawAcceptedApplication(
  taskStatus: string | undefined | null,
  escrow: { status?: string } | null | undefined
): { allowed: boolean; reason?: string } {
  if (isActiveEscrow(escrow)) {
    return {
      allowed: false,
      reason:
        'Cannot withdraw after payment is held for this task. Contact support if you need help.',
    };
  }

  if (isWorkInFlightStatus(taskStatus)) {
    return {
      allowed: false,
      reason:
        'Cannot withdraw while work is in progress or under review. Complete the task or contact the poster.',
    };
  }

  if (String(taskStatus || '').toLowerCase() === 'completed') {
    return {
      allowed: false,
      reason: 'Cannot withdraw from a completed task.',
    };
  }

  if (String(taskStatus || '').toLowerCase() !== 'assigned') {
    return {
      allowed: false,
      reason: 'Withdraw is only allowed before work has started on this task.',
    };
  }

  return { allowed: true };
}

export function isEndedRecurringPlanTask(
  task: Record<string, unknown> | null | undefined,
): boolean {
  if (!task || !isRecurringVisitPlanTask(task)) return false;
  const plan = task.recurringPlan as { status?: string } | undefined;
  return String(plan?.status || '').toLowerCase() === 'ended';
}

/** Parent plan no longer binds the tasker (left, cancelled, or ended). */
export function parentPlanReleasesTaskerCommitment(
  parent: Record<string, unknown> | null | undefined,
): boolean {
  if (!parent) return true;
  if (isEndedRecurringPlanTask(parent)) return true;
  const status = String(parent.status || '').toLowerCase();
  return status === 'cancelled' || status === 'open';
}

/**
 * True when the tasker still has a real in-flight assignment (not stale recurring rows
 * after leaving or ending a recurring plan).
 */
export async function taskerHasBlockingActiveTask(
  taskerProfileId: mongoose.Types.ObjectId,
  candidateTasks?: TaskScheduleFields | TaskScheduleFields[],
): Promise<boolean> {
  const candidates = await Task.find({
    assigneeId: taskerProfileId,
    status: { $in: [...TASKER_BLOCKING_STATUSES] },
  })
    .select('_id status parentTaskId recurringVisitId recurringPlan scheduledDate scheduledTimeStart scheduledTimeEnd timeSlot')
    .lean();

  const candidatesToCheck = Array.isArray(candidateTasks)
    ? candidateTasks
    : candidateTasks
    ? [candidateTasks]
    : [];

  for (const task of candidates) {
    const record = task as unknown as Record<string, unknown>;
    if (isEndedRecurringPlanTask(record)) continue;

    if (task.parentTaskId && task.recurringVisitId) {
      const parent = await Task.findById(task.parentTaskId)
        .select('status recurringPlan')
        .lean();
      if (parentPlanReleasesTaskerCommitment(parent as unknown as Record<string, unknown>)) {
        continue;
      }
    }

    if (!candidateTasks) {
      return true;
    }

    for (const candidate of candidatesToCheck) {
      if (taskSchedulesConflict(task as TaskScheduleFields, candidate)) {
        return true;
      }
    }
  }

  return false;
}
