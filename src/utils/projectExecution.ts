import mongoose from 'mongoose';
import {
  MAX_PROJECT_DAY_NOTE_LENGTH,
  MAX_PROJECT_DAY_PROOF_URLS,
  MAX_PROJECT_PLANNED_DAYS,
  PROJECT_DAY_ESTIMATED_MINUTES,
} from '../constants/projectExecution';
import type {
  IProjectExecution,
  IProjectExecutionDay,
  ProjectDayStatus,
  ProjectExecutionStatus,
} from '../models/Task';

export function clampPlannedDays(value?: number | null): number {
  const parsed = Math.round(Number(value) || 0);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(MAX_PROJECT_PLANNED_DAYS, parsed);
}

export function buildInitialProjectExecution(params: {
  quotationId: mongoose.Types.ObjectId;
  estimatedTimelineDays?: number | null;
  plannedStartDate?: Date;
}): IProjectExecution {
  const totalPlannedDays = clampPlannedDays(params.estimatedTimelineDays);
  const days: IProjectExecutionDay[] = Array.from({ length: totalPlannedDays }, (_, index) => ({
    dayNumber: index + 1,
    status: 'planned' as ProjectDayStatus,
  }));

  return {
    status: 'not_started',
    totalPlannedDays,
    completedDayCount: 0,
    activeDayNumber: null,
    quotationId: params.quotationId,
    plannedStartDate: params.plannedStartDate,
    days,
  };
}

export function estimateProjectDurationMinutes(totalPlannedDays: number): number {
  return clampPlannedDays(totalPlannedDays) * PROJECT_DAY_ESTIMATED_MINUTES;
}

export function normalizeDayProofUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .slice(0, MAX_PROJECT_DAY_PROOF_URLS);
}

export function normalizeDayNote(note: unknown): string | undefined {
  const trimmed = String(note || '').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_PROJECT_DAY_NOTE_LENGTH);
}

export function summarizeProjectExecution(
  projectExecution?: IProjectExecution | null,
): {
  status: ProjectExecutionStatus;
  totalPlannedDays: number;
  completedDayCount: number;
  activeDayNumber: number | null;
} | null {
  if (!projectExecution) return null;
  return {
    status: projectExecution.status,
    totalPlannedDays: projectExecution.totalPlannedDays,
    completedDayCount: projectExecution.completedDayCount,
    activeDayNumber: projectExecution.activeDayNumber ?? null,
  };
}

export function isTerminalProjectExecution(status?: ProjectExecutionStatus | string): boolean {
  return status === 'completed' || status === 'ended_early';
}
