import mongoose from 'mongoose';
import Task, { ITask } from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { NotFoundError } from '../errors/AppError';
import { PaymentClient } from './PaymentClient';
import { TaskService } from './TaskService';
import { getVisitsForPlan } from './RecurringVisitPlanStore';
import { isRecurringVisitPlanTask } from '../utils/recurringVisitMeta';

const MAX_VISIT_ESCROW_LOOKUPS = 24;

export class TaskTrackingBundleService {
  static async getTrackingBundle(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
  ): Promise<{
    task: ITask;
    isCurrentUserAssignee: boolean;
    applicationId: string | null;
    applicationStatus: string | null;
    escrowSummary: Record<string, unknown> | null;
    recurringVisits: Array<Record<string, unknown>>;
  }> {
    const task = await TaskService.getTaskById(taskId);

    const [myApplication, escrow, visits] = await Promise.all([
      TaskApplication.findOne({
        taskId: new mongoose.Types.ObjectId(taskId),
        applicantId: profileId,
      })
        .select('_id status')
        .lean(),
      PaymentClient.getEscrowByTaskId(taskId),
      isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)
        ? Promise.resolve(getVisitsForPlan(task))
        : Promise.resolve([]),
    ]);

    const isCurrentUserAssignee = Boolean(
      task.assigneeId && String(task.assigneeId) === String(profileId),
    );

    const visitsWithEscrow = await Promise.all(
      visits.slice(0, MAX_VISIT_ESCROW_LOOKUPS).map(async (visit) => {
        const visitId = String(visit.visitId || '');
        let escrowStatus: string | null = null;
        let visitEscrowId: string | null =
          typeof visit.escrowId === 'string' ? visit.escrowId : null;

        if (visitId) {
          const visitEscrow = await PaymentClient.getEscrowByTaskIdAndVisitId(taskId, visitId);
          if (visitEscrow) {
            escrowStatus =
              typeof visitEscrow.status === 'string'
                ? visitEscrow.status
                : typeof visitEscrow.paymentStatus === 'string'
                  ? visitEscrow.paymentStatus
                  : null;
            visitEscrowId =
              typeof visitEscrow.escrowId === 'string'
                ? visitEscrow.escrowId
                : visitEscrowId;
          }
        }

        return {
          visitId,
          visitIndex: visit.visitIndex,
          date: visit.date instanceof Date ? visit.date.toISOString() : visit.date,
          status: visit.status,
          paymentStatus: visit.paymentStatus,
          escrowId: visitEscrowId,
          escrowStatus,
          amount: visit.amount,
          assigneeId: visit.assigneeId ? String(visit.assigneeId) : null,
          childTaskId: visit.childTaskId ? String(visit.childTaskId) : null,
        };
      }),
    );

    return {
      task,
      isCurrentUserAssignee,
      applicationId: myApplication?._id ? String(myApplication._id) : null,
      applicationStatus: myApplication?.status ? String(myApplication.status) : null,
      escrowSummary: escrow
        ? {
            escrowId: escrow.escrowId,
            status: escrow.status,
            paymentStatus: escrow.paymentStatus,
            amountInRupees: escrow.amountInRupees,
            taskAmount: escrow.taskAmount,
            performerUid: escrow.performerUid,
          }
        : null,
      recurringVisits: visitsWithEscrow,
    };
  }

  static async getMyApplicationForTask(
    taskId: string,
    profileId: mongoose.Types.ObjectId,
  ): Promise<{
    applicationId: string | null;
    status: string | null;
    isAssignee: boolean;
  }> {
    const taskObjectId = new mongoose.Types.ObjectId(taskId);

    const [task, application] = await Promise.all([
      Task.findById(taskObjectId).select('assigneeId').lean(),
      TaskApplication.findOne({
        taskId: taskObjectId,
        applicantId: profileId,
      })
        .select('_id status')
        .lean(),
    ]);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    return {
      applicationId: application?._id ? String(application._id) : null,
      status: application?.status ? String(application.status) : null,
      isAssignee: Boolean(task.assigneeId && String(task.assigneeId) === String(profileId)),
    };
  }
}
