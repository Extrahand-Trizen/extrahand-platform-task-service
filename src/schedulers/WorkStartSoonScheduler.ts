import cron from 'node-cron';
import mongoose from 'mongoose';
import Task from '../models/Task';
import logger from '../config/logger';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { taskOpenAppButton } from '../utils/whatsappTaskButtons';
import { resolveWorkStartInstant, buildScheduleVersion } from '../utils/workSchedule';
import {
  hasStartedBeforeSchedule,
  isReminderEligibleStatus,
} from '../services/notificationGovernance';

type StartSoonSlot = '2h' | '30m';

const SLOT_CONFIG: Record<
  StartSoonSlot,
  { label: string; windowMs: { before: number; after: number } }
> = {
  '2h': {
    label: '2 hours',
    windowMs: { before: 2 * 60 * 60 * 1000, after: 15 * 60 * 1000 },
  },
  '30m': {
    label: '30 minutes',
    windowMs: { before: 30 * 60 * 1000, after: 10 * 60 * 1000 },
  },
};

/**
 * Sends wa_work_starting_soon at 2h and 30m before scheduled start.
 * Idempotency: wa_work_starting_soon:{taskId}:{uid}:{slot}:{scheduleVersion}
 */
export class WorkStartSoonScheduler {
  private static isInitialized = false;

  static async initialize(serviceName: string = 'task-service'): Promise<void> {
    if (this.isInitialized) return;

    // Every 15 minutes — tight enough for 30m window.
    cron.schedule('*/15 * * * *', async () => {
      await this.runJob();
    });

    this.isInitialized = true;
    logger.info('WorkStartSoonScheduler initialized', { serviceName });
  }

  private static async runJob(): Promise<void> {
    const now = Date.now();

    for (const slot of ['2h', '30m'] as StartSoonSlot[]) {
      const cfg = SLOT_CONFIG[slot];
      const targetMs = now + cfg.windowMs.before;
      const lower = new Date(targetMs - cfg.windowMs.after);
      const upper = new Date(targetMs + cfg.windowMs.after);

      // Narrow by calendar day around the target window (exact time checked per task).
      const dayPadMs = 26 * 60 * 60 * 1000;
      const tasks = await Task.find({
        scheduledDate: {
          $gte: new Date(targetMs - dayPadMs),
          $lte: new Date(targetMs + dayPadMs),
        },
        status: { $in: ['assigned', 'started', 'in_progress'] },
      })
        .select(
          '_id title status scheduledDate scheduledTimeStart scheduledTimeEnd requesterId assigneeId startedAt notificationGovernance'
        )
        .lean();

      for (const task of tasks) {
        try {
          const startInstant = resolveWorkStartInstant(task);
          if (!startInstant) continue;
          if (startInstant < lower || startInstant > upper) continue;
          if (!isReminderEligibleStatus(task.status)) continue;
          if (
            hasStartedBeforeSchedule({
              status: task.status,
              startedAt: task.startedAt,
              scheduledStart: startInstant,
            })
          ) {
            continue;
          }

          const scheduleVersion =
            (task as { notificationGovernance?: { scheduleVersion?: string } })
              .notificationGovernance?.scheduleVersion ?? buildScheduleVersion(task);

          const Profile = mongoose.connection.collection('profiles');
          const requesterProfile = await Profile.findOne({ _id: task.requesterId });
          const assigneeProfile = task.assigneeId
            ? await Profile.findOne({ _id: task.assigneeId })
            : null;

          const taskTitle = task.title || 'your task';

          if (requesterProfile?.uid) {
            if (slot === '30m' && !task.assigneeId) {
              // Customer copy assumes a helper is assigned.
            } else {
              fireWhatsAppNotify({
                uid: String(requesterProfile.uid),
                templateKey: 'wa_work_starting_soon',
                category: 'taskReminders',
                templateBody: {
                  var_1: taskTitle,
                  var_2: cfg.label,
                },
                templateButtons: taskOpenAppButton(String(task._id)),
                idempotencyKey: `wa_work_starting_soon:${task._id}:${requesterProfile.uid}:${slot}:${scheduleVersion}`,
                metadata: {
                  workId: String(task._id),
                  triggerType: slot,
                  recipientRole: 'customer',
                },
              });
            }
          }

          if (assigneeProfile?.uid && task.assigneeId) {
            fireWhatsAppNotify({
              uid: String(assigneeProfile.uid),
              templateKey: 'wa_work_starting_soon',
              category: 'taskReminders',
              templateBody: {
                var_1: taskTitle,
                var_2: cfg.label,
              },
              templateButtons: taskOpenAppButton(String(task._id)),
              idempotencyKey: `wa_work_starting_soon:${task._id}:${assigneeProfile.uid}:${slot}:${scheduleVersion}`,
              metadata: {
                workId: String(task._id),
                triggerType: slot,
                recipientRole: 'helper',
              },
            });
          }
        } catch (err) {
          logger.warn('WorkStartSoonScheduler: task skipped', {
            taskId: task._id,
            slot,
            error: err instanceof Error ? err.message : err,
          });
        }
      }
    }
  }
}
