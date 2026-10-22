import cron from 'node-cron';
import Task, { ITask } from '../models/Task';
import logger from '../config/logger';
import { BookNowAutoAssignService } from '../services/BookNowAutoAssignService';

export class BookNowOfferScheduler {
  private static isInitialized = false;
  private static isRunning = false;

  static async initialize(serviceName: string = 'task-service'): Promise<void> {
    if (this.isInitialized) return;

    cron.schedule('* * * * *', async () => {
      await this.runJob();
    });

    this.isInitialized = true;
    logger.info('BookNowOfferScheduler initialized', { serviceName });
    void this.runJob();
  }

  private static async runJob(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const now = new Date();
      const undispatchedTasks = await Task.find({
        bookingSource: 'book_now',
        status: 'open',
        assigneeId: null,
        assigneeUid: null,
        partnerId: null,
        partnerUid: null,
        $or: [
          { assignmentOffer: { $exists: false } },
          { assignmentOffer: null },
        ],
      })
        .sort({ createdAt: 1 })
        .limit(250);

      for (const task of undispatchedTasks) {
        try {
          const result = await BookNowAutoAssignService.dispatchBookNowOffers(
            task.toObject() as ITask,
          );
          if (result.offered) {
            logger.info('[BookNowOfferScheduler] Recovered unstarted partner offer dispatch', {
              taskId: String(task._id),
              reason: result.reason,
            });
          } else if (!result.assigned) {
            logger.warn('[BookNowOfferScheduler] Could not start partner offer dispatch', {
              taskId: String(task._id),
              reason: result.reason,
            });
          }
        } catch (error) {
          logger.error('[BookNowOfferScheduler] Could not start partner offer dispatch', {
            taskId: String(task._id),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const activeOfferTasks = await Task.find({
        bookingSource: 'book_now',
        status: 'open',
        'assignmentOffer.stage': { $in: ['preferred', 'area_rule', 'all'] },
        'assignmentOffer.expiresAt': { $gt: now },
        'assignmentOffer.recipientUids.0': { $exists: true },
      })
        .select('_id')
        .limit(250)
        .lean();

      for (const task of activeOfferTasks) {
        try {
          await BookNowAutoAssignService.retryUnnotifiedOffers(String(task._id));
        } catch (error) {
          logger.error('[BookNowOfferScheduler] Could not retry partner offer notification', {
            taskId: String(task._id),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const tasks = await Task.find({
        bookingSource: 'book_now',
        status: 'open',
        'assignmentOffer.stage': { $in: ['preferred', 'area_rule', 'all'] },
        'assignmentOffer.expiresAt': { $lte: now },
      })
        .select('_id')
        .sort({ 'assignmentOffer.expiresAt': 1 })
        .limit(250)
        .lean();

      for (const task of tasks) {
        try {
          await BookNowAutoAssignService.advanceOfferStage(String(task._id));
        } catch (error) {
          logger.error('[BookNowOfferScheduler] Could not advance partner offers', {
            taskId: String(task._id),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const escalated = await Task.updateMany(
        {
          bookingSource: 'book_now',
          status: 'open',
          'dispatchProgress.supportEscalation.status': 'pending',
          'dispatchProgress.supportEscalation.dueAt': { $lte: now },
        },
        {
          $set: {
            'dispatchProgress.supportEscalation.status': 'escalated',
            'dispatchProgress.supportEscalation.escalatedAt': now,
          },
        },
      );
      if (escalated.modifiedCount > 0) {
        logger.info('[BookNowOfferScheduler] Unassigned work escalated to support', {
          taskCount: escalated.modifiedCount,
        });
      }
    } catch (error) {
      logger.error('[BookNowOfferScheduler] Offer scan failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isRunning = false;
    }
  }
}
