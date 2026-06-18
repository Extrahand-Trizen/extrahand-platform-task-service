import cron from 'node-cron';
import Task from '../models/Task';
import logger from '../config/logger';
import { RecurringVisitService } from '../services/RecurringVisitService';
import { isRecurringVisitPlanTask } from '../utils/recurringVisitMeta';

export class RecurringVisitScheduler {
  private static isInitialized = false;

  static async initialize(serviceName: string = 'task-service'): Promise<void> {
    if (this.isInitialized) {
      logger.warn('RecurringVisitScheduler already initialized');
      return;
    }

    cron.schedule('*/30 * * * *', async () => {
      await this.runMaintenanceJob();
    });

    this.isInitialized = true;
    logger.info('RecurringVisitScheduler initialized', { serviceName });
  }

  private static async runMaintenanceJob(): Promise<void> {
    try {
      const now = new Date();
      const plans = await Task.find({
        'recurring.enabled': true,
        'recurringPlan.planVersion': 2,
        'recurringPlan.status': { $in: ['active', 'paused'] },
      })
        .select('_id schedule recurringPlan')
        .limit(200)
        .lean();

      for (const task of plans) {
        if (!isRecurringVisitPlanTask(task as Record<string, unknown>)) continue;

        const taskId = String(task._id);
        const schedule = Array.isArray(task.schedule) ? task.schedule : [];

        for (const visit of schedule) {
          const row = visit as {
            visitId?: string;
            status?: string;
            paymentDeadline?: Date;
          };
          if (row.status !== 'payment_pending' || !row.visitId) continue;

          const deadline = row.paymentDeadline ? new Date(row.paymentDeadline) : null;
          if (deadline && deadline.getTime() <= now.getTime()) {
            await RecurringVisitService.markVisitUnpaid(taskId, row.visitId);
          }
        }

        const planStatus = (task as { recurringPlan?: { status?: string } }).recurringPlan?.status;
        if (planStatus === 'active') {
          await RecurringVisitService.ensureMaterializedBuffer(taskId);
        }
      }
    } catch (error) {
      logger.error('[RecurringVisitScheduler] maintenance job failed', { error });
    }
  }
}
