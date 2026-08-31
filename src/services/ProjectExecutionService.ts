import mongoose from 'mongoose';
import Task, { type IProjectExecution, type ITask } from '../models/Task';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../errors/AppError';
import { CompletionService } from './CompletionService';
import { MIN_PROJECT_COMPLETION_PROOF_IMAGES } from '../constants/projectExecution';
import {
  isTerminalProjectExecution,
  normalizeDayNote,
  normalizeDayProofUrls,
} from '../utils/projectExecution';
import logger from '../config/logger';

type TaskActorRole = 'partner' | 'customer' | 'none';

function assertObjectId(taskId: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    throw new BadRequestError('Invalid task id');
  }
  return new mongoose.Types.ObjectId(taskId);
}

function resolveActorRole(
  task: ITask,
  actorProfileId: mongoose.Types.ObjectId,
  actorUid?: string,
): TaskActorRole {
  const actorId = String(actorProfileId);
  const normalizedUid = String(actorUid || '').trim();
  if (String(task.requesterId) === actorId) return 'customer';
  if (String(task.assigneeId || '') === actorId) return 'partner';
  if (String(task.partnerId || '') === actorId) return 'partner';
  if (normalizedUid && String(task.assigneeUid || '').trim() === normalizedUid) return 'partner';
  if (normalizedUid && String(task.partnerUid || '').trim() === normalizedUid) return 'partner';
  return 'none';
}

function assertPartnerActor(
  task: ITask,
  actorProfileId: mongoose.Types.ObjectId,
  actorUid?: string,
): void {
  if (resolveActorRole(task, actorProfileId, actorUid) !== 'partner') {
    throw new ForbiddenError('Only the assigned partner can update project execution');
  }
}

function assertProjectTask(task: ITask): IProjectExecution {
  if (!task.projectExecution) {
    throw new ConflictError('Project execution has not been initialized for this task');
  }
  const bookingKind = String(task.bookingKind || '').toLowerCase();
  const serviceFlowType = String(task.serviceFlowType || '').toLowerCase();
  const stage = String(task.consultationState?.currentStage || '').toLowerCase();
  const isProjectTask =
    bookingKind === 'project' ||
    serviceFlowType === 'consultation_project' ||
    stage === 'project_created';
  if (!isProjectTask) {
    throw new BadRequestError('This task is not a multi-day project');
  }
  return task.projectExecution;
}

function findDay(projectExecution: IProjectExecution, dayNumber: number) {
  return projectExecution.days.find((day) => day.dayNumber === dayNumber);
}

function serializeProjectExecution(projectExecution: IProjectExecution) {
  return {
    status: projectExecution.status,
    totalPlannedDays: projectExecution.totalPlannedDays,
    completedDayCount: projectExecution.completedDayCount,
    activeDayNumber: projectExecution.activeDayNumber ?? null,
    quotationId: projectExecution.quotationId
      ? String(projectExecution.quotationId)
      : undefined,
    plannedStartDate: projectExecution.plannedStartDate,
    startedAt: projectExecution.startedAt,
    completedAt: projectExecution.completedAt,
    days: projectExecution.days.map((day) => ({
      dayNumber: day.dayNumber,
      status: day.status,
      startedAt: day.startedAt,
      completedAt: day.completedAt,
      notePreview: day.notePreview,
      proofCount: day.proofCount ?? 0,
    })),
  };
}

export class ProjectExecutionService {
  static async getProjectExecution(
    taskId: string,
    actorProfileId: mongoose.Types.ObjectId,
    actorUid?: string,
  ) {
    const taskOid = assertObjectId(taskId);
    const task = await Task.findById(taskOid).lean<ITask>();
    if (!task) throw new NotFoundError('Task not found');

    const role = resolveActorRole(task, actorProfileId, actorUid);
    if (role === 'none') {
      throw new ForbiddenError('Not authorized to view this project execution');
    }

    const projectExecution = assertProjectTask(task);
    return {
      taskId: String(task._id),
      taskStatus: task.status,
      projectExecution: serializeProjectExecution(projectExecution),
    };
  }

  static async startDay(
    taskId: string,
    dayNumber: number,
    actorProfileId: mongoose.Types.ObjectId,
    actorUid?: string,
  ) {
    const taskOid = assertObjectId(taskId);
    const normalizedDay = Math.round(Number(dayNumber));
    if (!Number.isFinite(normalizedDay) || normalizedDay < 1) {
      throw new BadRequestError('dayNumber must be a positive integer');
    }

    const task = await Task.findById(taskOid);
    if (!task) throw new NotFoundError('Task not found');
    assertPartnerActor(task, actorProfileId, actorUid);
    const projectExecution = assertProjectTask(task);

    if (isTerminalProjectExecution(projectExecution.status)) {
      throw new ConflictError('This project is already finished');
    }

    const day = findDay(projectExecution, normalizedDay);
    if (!day) {
      throw new BadRequestError(`Day ${normalizedDay} is outside the planned project timeline`);
    }

    const activeDayNumber = projectExecution.activeDayNumber ?? null;
    if (activeDayNumber != null && activeDayNumber !== normalizedDay) {
      throw new ConflictError(`Day ${activeDayNumber} is still active. Complete it before starting another day.`);
    }

    if (day.status === 'completed' || day.status === 'skipped') {
      throw new ConflictError(`Day ${normalizedDay} is already closed`);
    }

    const expectedDay = projectExecution.completedDayCount + 1;
    if (day.status === 'planned' && normalizedDay !== expectedDay) {
      throw new BadRequestError(`Start day ${expectedDay} before day ${normalizedDay}`);
    }

    if (day.status === 'active' && activeDayNumber === normalizedDay) {
      return this.getProjectExecution(taskId, actorProfileId, actorUid);
    }

    const now = new Date();
    const dayIndex = projectExecution.days.findIndex((entry) => entry.dayNumber === normalizedDay);
    if (dayIndex < 0) {
      throw new BadRequestError(`Day ${normalizedDay} is outside the planned project timeline`);
    }

    task.projectExecution!.days[dayIndex].status = 'active';
    task.projectExecution!.days[dayIndex].startedAt = now;
    task.projectExecution!.status = 'active';
    task.projectExecution!.activeDayNumber = normalizedDay;
    if (!task.projectExecution!.startedAt) {
      task.projectExecution!.startedAt = now;
    }

    const status = String(task.status || '').toLowerCase();
    if (['assigned', 'accepted', 'open_assigned', 'paid', 'assigning'].includes(status)) {
      task.status = 'in_progress';
      task.inProgressAt = task.inProgressAt || now;
    } else if (status === 'started') {
      task.status = 'in_progress';
      task.inProgressAt = task.inProgressAt || now;
    }

    task.markModified('projectExecution');
    await task.save();

    logger.info('[ProjectExecutionService] startDay', {
      taskId,
      dayNumber: normalizedDay,
      partnerId: String(actorProfileId),
    });

    return this.getProjectExecution(taskId, actorProfileId, actorUid);
  }

  static async completeDay(
    taskId: string,
    dayNumber: number,
    actorProfileId: mongoose.Types.ObjectId,
    input: { notes?: string; proofUrls?: string[] },
    actorUid?: string,
  ) {
    const taskOid = assertObjectId(taskId);
    const normalizedDay = Math.round(Number(dayNumber));
    if (!Number.isFinite(normalizedDay) || normalizedDay < 1) {
      throw new BadRequestError('dayNumber must be a positive integer');
    }

    const task = await Task.findById(taskOid);
    if (!task) throw new NotFoundError('Task not found');
    assertPartnerActor(task, actorProfileId, actorUid);
    const projectExecution = assertProjectTask(task);

    if (isTerminalProjectExecution(projectExecution.status)) {
      throw new ConflictError('This project is already finished');
    }

    if (projectExecution.activeDayNumber !== normalizedDay) {
      throw new ConflictError(`Day ${normalizedDay} is not the active work day`);
    }

    const dayIndex = projectExecution.days.findIndex((entry) => entry.dayNumber === normalizedDay);
    if (dayIndex < 0) {
      throw new BadRequestError(`Day ${normalizedDay} is outside the planned project timeline`);
    }

    const proofUrls = normalizeDayProofUrls(input.proofUrls);
    const notePreview = normalizeDayNote(input.notes);
    const now = new Date();

    task.projectExecution!.days[dayIndex].status = 'completed';
    task.projectExecution!.days[dayIndex].completedAt = now;
    task.projectExecution!.days[dayIndex].notePreview = notePreview;
    task.projectExecution!.days[dayIndex].proofCount = proofUrls.length;
    task.projectExecution!.completedDayCount = Math.min(
      projectExecution.totalPlannedDays,
      projectExecution.completedDayCount + 1,
    );
    task.projectExecution!.activeDayNumber = null;

    const allDaysCompleted =
      task.projectExecution!.completedDayCount >= projectExecution.totalPlannedDays;
    if (allDaysCompleted) {
      task.projectExecution!.status = 'active';
    }

    task.markModified('projectExecution');
    await task.save();

    logger.info('[ProjectExecutionService] completeDay', {
      taskId,
      dayNumber: normalizedDay,
      partnerId: String(actorProfileId),
      proofCount: proofUrls.length,
    });

    return this.getProjectExecution(taskId, actorProfileId, actorUid);
  }

  static async completeProject(
    taskId: string,
    actorProfileId: mongoose.Types.ObjectId,
    input: { proofUrls?: string[]; notes?: string; endedEarly?: boolean },
    actorUid?: string,
  ) {
    const taskOid = assertObjectId(taskId);
    const task = await Task.findById(taskOid);
    if (!task) throw new NotFoundError('Task not found');
    assertPartnerActor(task, actorProfileId, actorUid);
    const projectExecution = assertProjectTask(task);

    if (isTerminalProjectExecution(projectExecution.status)) {
      throw new ConflictError('This project is already finished');
    }

    if (projectExecution.activeDayNumber != null) {
      throw new ConflictError(
        `Complete day ${projectExecution.activeDayNumber} before ending the project`,
      );
    }

    const proofUrls = normalizeDayProofUrls(input.proofUrls);
    if (proofUrls.length < MIN_PROJECT_COMPLETION_PROOF_IMAGES) {
      throw new BadRequestError(
        `Please upload at least ${MIN_PROJECT_COMPLETION_PROOF_IMAGES} completion photos`,
      );
    }

    const now = new Date();
    const endedEarly = Boolean(input.endedEarly) ||
      projectExecution.completedDayCount < projectExecution.totalPlannedDays;
    const finalStatus = endedEarly ? 'ended_early' : 'completed';

    for (const day of task.projectExecution!.days) {
      if (day.status === 'planned') {
        day.status = 'skipped';
      } else if (day.status === 'active') {
        day.completedAt = now;
        day.status = 'skipped';
      }
    }

    task.projectExecution!.status = finalStatus;
    task.projectExecution!.activeDayNumber = null;
    task.projectExecution!.completedAt = now;

    const currentStatus = String(task.status || '').toLowerCase();
    if (!['in_progress', 'started', 'review'].includes(currentStatus)) {
      task.status = 'in_progress';
      task.inProgressAt = task.inProgressAt || now;
    }

    task.markModified('projectExecution');
    await task.save();

    const completionResult = await CompletionService.submitCompletionProof(
      taskId,
      String(actorProfileId),
      {
        proofUrls,
        notes: String(input.notes || '').trim() || undefined,
      },
    );

    logger.info('[ProjectExecutionService] completeProject', {
      taskId,
      partnerId: String(actorProfileId),
      endedEarly,
      completedDayCount: projectExecution.completedDayCount,
    });

    return {
      ...(await this.getProjectExecution(taskId, actorProfileId, actorUid)),
      completion: completionResult,
    };
  }
}
