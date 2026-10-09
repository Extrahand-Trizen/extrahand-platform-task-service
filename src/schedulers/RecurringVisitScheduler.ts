import crypto from 'crypto';
import cron from 'node-cron';
import mongoose from 'mongoose';
import Task from '../models/Task';
import logger from '../config/logger';
import { getRedisClient } from '../config/redis';
import { RecurringVisitService } from '../services/RecurringVisitService';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { recurringVisitConfig } from '../config/recurringVisitConfig';
import { BookNowRecurringService } from '../services/BookNowRecurringService';

const MAINTENANCE_LOCK_KEY = 'recurring:scheduler:maintenance:lock';
/** Shorter than the 30 min cron interval so a crashed holder never blocks the next run. */
const MAINTENANCE_LOCK_TTL_MS = 25 * 60 * 1000;
/** Upper bound on overdue batches per run (each batch re-queries; resolved visits drop out). */
const MAX_OVERDUE_BATCHES = 20;

const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export class RecurringVisitScheduler {
  private static isInitialized = false;
  private static isRunning = false;

  static async initialize(serviceName: string = 'task-service'): Promise<void> {
    if (this.isInitialized) {
      logger.warn('RecurringVisitScheduler already initialized');
      return;
    }

    cron.schedule('*/30 * * * *', async () => {
      await this.runExclusive();
    });

    this.isInitialized = true;
    logger.info('RecurringVisitScheduler initialized', { serviceName });
  }

  /** One run at a time per process, and one instance cluster-wide via a Redis lock. */
  private static async runExclusive(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[RecurringVisitScheduler] previous run still in progress; skipping');
      return;
    }
    this.isRunning = true;
    const token = crypto.randomUUID();
    const redis = getRedisClient();
    let lockHeld = false;
    try {
      if (redis) {
        try {
          const acquired = await redis.set(
            MAINTENANCE_LOCK_KEY,
            token,
            'PX',
            MAINTENANCE_LOCK_TTL_MS,
            'NX',
          );
          if (acquired !== 'OK') {
            logger.debug('[RecurringVisitScheduler] another instance holds the lock; skipping');
            return;
          }
          lockHeld = true;
        } catch (error) {
          logger.warn('[RecurringVisitScheduler] Redis lock unavailable; running locally', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await this.runMaintenanceJob();
    } finally {
      if (lockHeld && redis) {
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, MAINTENANCE_LOCK_KEY, token).catch(() => undefined);
      }
      this.isRunning = false;
    }
  }

  private static async runMaintenanceJob(): Promise<void> {
    try {
      const now = new Date();
      const batchSize = recurringVisitConfig.schedulerBatchSize;

      await this.markOverdueVisitsUnpaid(now, batchSize);
      await this.refillActivePlanBuffers(batchSize);
      await this.markLegacyOverdueVisitsUnpaid(now, batchSize);
      await BookNowRecurringService.runMaintenance(now);
    } catch (error) {
      logger.error('[RecurringVisitScheduler] maintenance job failed', { error });
    }
  }

  private static async markOverdueVisitsUnpaid(now: Date, batchSize: number): Promise<void> {
    const attempted = new Set<string>();
    for (let batch = 0; batch < MAX_OVERDUE_BATCHES; batch += 1) {
      const overdueVisits = await RecurringVisitRepository.findOverduePaymentPending({
        limit: batchSize,
        now,
      });
      const fresh = overdueVisits.filter((v) => !attempted.has(`${v.parentTaskId}:${v.visitId}`));
      if (fresh.length === 0) return;

      for (const visit of fresh) {
        const taskId = String(visit.parentTaskId);
        const visitId = String(visit.visitId);
        attempted.add(`${taskId}:${visitId}`);
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
      if (overdueVisits.length < batchSize) return;
    }
  }

  private static async refillActivePlanBuffers(batchSize: number): Promise<void> {
    let lastId: mongoose.Types.ObjectId | null = null;
    for (;;) {
      const filter: Record<string, unknown> = {
        'recurringPlan.status': 'active',
        'recurring.enabled': true,
        status: { $ne: 'cancelled' },
        $or: [
          { 'recurringPlan.visitStorage': 'collection' },
          { 'recurringPlan.planVersion': 2 },
        ],
      };
      if (lastId) filter._id = { $gt: lastId };

      const activePlans = await Task.find(filter)
        .select('_id')
        .sort({ _id: 1 })
        .limit(batchSize)
        .lean();
      if (activePlans.length === 0) return;

      for (const task of activePlans) {
        try {
          await RecurringVisitService.ensureMaterializedBuffer(String(task._id));
        } catch (error) {
          logger.warn('[RecurringVisitScheduler] ensureMaterializedBuffer failed', {
            taskId: String(task._id),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      lastId = activePlans[activePlans.length - 1]._id as mongoose.Types.ObjectId;
      if (activePlans.length < batchSize) return;
    }
  }

  /** Legacy embedded plans still on schedule[] (until backfill completes). */
  private static async markLegacyOverdueVisitsUnpaid(now: Date, batchSize: number): Promise<void> {
    if (!recurringVisitConfig.legacyFallback) return;
    const legacyPlans = await Task.find({
      'recurring.enabled': true,
      'recurringPlan.planVersion': 2,
      'recurringPlan.status': { $in: ['active', 'paused'] },
      'recurringPlan.visitStorage': { $ne: 'collection' },
      schedule: { $exists: true, $not: { $size: 0 } },
    })
      .select('_id schedule recurringPlan')
      .sort({ _id: 1 })
      .limit(Math.max(20, Math.floor(batchSize / 4)))
      .lean();

    for (const task of legacyPlans) {
      const taskId = String(task._id);
      try {
        const hasCollection = await RecurringVisitRepository.hasCollectionVisits(task._id);
        if (hasCollection) continue;

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
      } catch (error) {
        logger.warn('[RecurringVisitScheduler] legacy overdue sweep failed', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
