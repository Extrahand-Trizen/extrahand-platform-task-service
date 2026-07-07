import cron from 'node-cron';
import Task from '../models/Task';
import logger from '../config/logger';
import { RecurringVisitService } from '../services/RecurringVisitService';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { recurringVisitConfig } from '../config/recurringVisitConfig';

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
      const batchSize = recurringVisitConfig.schedulerBatchSize;

      const overdueVisits = await RecurringVisitRepository.findOverduePaymentPending({
        limit: batchSize,
        now,
      });

      for (const visit of overdueVisits) {
        const taskId = String(visit.parentTaskId);
        const visitId = String(visit.visitId);
        try {
          await RecurringVisitService.markVisitUnpaid(taskId, visitId);
        } catch (error) {
          logger.warn('[RecurringVisitScheduler] markVisitUnpaid failed', {
            taskId,
            visitId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const activePlans = await Task.find({
        'recurring.enabled': true,
        'recurringPlan.status': 'active',
        $or: [
          { 'recurringPlan.visitStorage': 'collection' },
          { 'recurringPlan.planVersion': 2 },
        ],
      })
        .select('_id recurringPlan')
        .limit(batchSize)
        .lean();

      for (const task of activePlans) {
        const plan = (task as { recurringPlan?: { status?: string } }).recurringPlan;
        if (plan?.status !== 'active') continue;
        try {
          await RecurringVisitService.ensureMaterializedBuffer(String(task._id));
        } catch (error) {
          logger.warn('[RecurringVisitScheduler] ensureMaterializedBuffer failed', {
            taskId: String(task._id),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Legacy embedded plans still on schedule[] (until backfill completes)
      const legacyPlans = await Task.find({
        'recurring.enabled': true,
        'recurringPlan.planVersion': 2,
        'recurringPlan.status': { $in: ['active', 'paused'] },
        'recurringPlan.visitStorage': { $ne: 'collection' },
        schedule: { $exists: true, $not: { $size: 0 } },
      })
        .select('_id schedule recurringPlan')
        .limit(Math.max(20, Math.floor(batchSize / 4)))
        .lean();

      for (const task of legacyPlans) {
        const hasCollection = await RecurringVisitRepository.hasCollectionVisits(task._id);
        if (hasCollection) continue;

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
      }
    } catch (error) {
      logger.error('[RecurringVisitScheduler] maintenance job failed', { error });
    }
  }
}
