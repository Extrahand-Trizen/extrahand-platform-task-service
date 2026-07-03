import cron from 'node-cron';
import mongoose from 'mongoose';
import Task from '../models/Task';
import logger from '../config/logger';
import { config } from '../config/env';
import { NotificationClient } from '../services/NotificationClient';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { buildScheduleVersion } from '../utils/workSchedule';

/**
 * ReminderScheduler
 * 
 * Sends TASK_REMINDER_24H notifications to task requester and assignee
 * 24 hours before scheduled task time.
 * 
 * Runs: Hourly cron job (every hour)
 * Query window: Tasks scheduled 23-25 hours from now
 * Event: TASK_REMINDER_24H
 * Idempotency: Uses eventId formula (eventKey:taskId:minuteBucket)
 * 
 * Only sends reminders for tasks in valid states:
 * - assigned: Task has been accepted by tasker
 * - started: Tasker has started the task
 * 
 * Cost-control: Only sends 1 reminder per task per 24h period
 * (idempotency key ensures no duplicates within minute bucket)
 */
export class ReminderScheduler {
  private static isInitialized = false;

  /**
   * Initialize the reminder scheduler
   * Call once at app startup
   * 
   * @param serviceName - Name of the service (for logging)
   * 
   * Usage:
   * // In app.ts after NotificationClient initialization
   * await ReminderScheduler.initialize('task-service');
   */
  static async initialize(serviceName: string = 'task-service'): Promise<void> {
    if (this.isInitialized) {
      logger.warn('ReminderScheduler already initialized');
      return;
    }

    // Run every hour at minute 0
    cron.schedule('0 * * * *', async () => {
      await this.runReminderJob();
    });

    this.isInitialized = true;
    logger.info('ReminderScheduler initialized', { serviceName });
  }

  /**
   * Check for tasks that need reminders (23-25 hours from now)
   * and emit TASK_REMINDER_24H notifications
   * 
   * Private: Called by cron job only
   */
  private static async runReminderJob(): Promise<void> {
    try {
      logger.info('ReminderScheduler: Starting reminder job');

      // Calculate time window: 23-25 hours from now
      const now = new Date();
      const lowerBound = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23h from now
      const upperBound = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25h from now

      // Find tasks in the window with valid states
      const tasksNeedingReminders = await Task.find({
        scheduledDate: {
          $gte: lowerBound,
          $lte: upperBound
        },
        status: { $in: ['assigned', 'started'] },
        // Exclude tasks that already had reminder sent (optional - use eventId dedup in notification-service)
      })
        .select('_id scheduledDate scheduledTimeStart scheduledTimeEnd requesterId assigneeId title location notificationGovernance')
        .lean();

      logger.info('ReminderScheduler: Found tasks needing reminders', {
        count: tasksNeedingReminders.length,
        windowStart: lowerBound.toISOString(),
        windowEnd: upperBound.toISOString()
      });

      // Send reminders for each task
      for (const task of tasksNeedingReminders) {
        try {
          const recipients: string[] = [task.requesterId.toString()];
          
          // Add assignee if different from requester
          if (task.assigneeId && task.assigneeId.toString() !== task.requesterId.toString()) {
            recipients.push(task.assigneeId.toString());
          }

          await NotificationClient.send(
            {
              eventKey: 'TASK_REMINDER_24H',
              category: 'taskReminders',
              recipients,
              entity: { type: 'task', id: task._id.toString() },
              title: `Reminder: "${task.title}" is coming up soon`,
              body: `Your task is scheduled for tomorrow. Make sure both of you are ready!`,
              data: {
                taskId: task._id.toString(),
                scheduledDate: task.scheduledDate?.toISOString(),
                actionUrl: `/tasks/${task._id}`
              }
            }
          );

          // Email: task_reminder → requester + assignee
          try {
            const Profile = mongoose.connection.collection('profiles');
            // Look up profiles by _id (requesterId and assigneeId are already ObjectIds from Task model)
            const requesterProfile = await Profile.findOne({ 
              _id: task.requesterId instanceof mongoose.Types.ObjectId 
                ? task.requesterId 
                : new mongoose.Types.ObjectId(task.requesterId) 
            });
            const assigneeProfile = task.assigneeId
              ? await Profile.findOne({ 
                  _id: task.assigneeId instanceof mongoose.Types.ObjectId 
                    ? task.assigneeId 
                    : new mongoose.Types.ObjectId(task.assigneeId) 
                })
              : null;
            const scheduledDateStr = task.scheduledDate
              ? new Date(task.scheduledDate).toLocaleDateString()
              : undefined;
            const scheduledTimeStr =
              task.scheduledTimeStart || task.scheduledTimeEnd
                ? [task.scheduledTimeStart, task.scheduledTimeEnd].filter(Boolean).join(' – ')
                : undefined;
            const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
            const locationStr = task.location?.city || task.location?.address;

            const scheduleVersion =
              (task as { notificationGovernance?: { scheduleVersion?: string } })
                .notificationGovernance?.scheduleVersion ??
              buildScheduleVersion(task);

            if (requesterProfile?.uid) {
              fireWhatsAppNotify({
                uid: requesterProfile.uid,
                templateKey: 'wa_task_reminder',
                category: 'taskReminders',
                templateBody: {
                  var_1: task.title || 'your task',
                  var_2: scheduledDateStr || 'soon',
                },
                idempotencyKey: `wa_task_reminder:${task._id.toString()}:${requesterProfile.uid}:24h:${scheduleVersion}`,
                metadata: {
                  workId: task._id.toString(),
                  triggerType: '24h',
                  recipientRole: 'customer',
                },
              });
            }

            if (requesterProfile?.email && requesterProfile?.uid) {
              // Check if user has enabled task reminder emails
              const { NotificationPreferenceChecker } = await import('../services/NotificationPreferenceChecker');
              const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                requesterProfile.uid,
                'taskReminders'
              );
              
              if (emailEnabled) {
                EmailServiceClient.sendTaskReminder(requesterProfile.email, {
                  recipientName: requesterProfile.name || requesterProfile.fullName || 'There',
                  taskTitle: task.title,
                  scheduledDate: scheduledDateStr,
                  scheduledTime: scheduledTimeStr,
                  location: locationStr,
                  isTasker: false,
                  otherPartyName: assigneeProfile?.name || assigneeProfile?.fullName,
                  taskUrl,
                  userId: requesterProfile.uid,
                }).catch((err) =>
                  logger.error('ReminderScheduler: Error sending task_reminder email to requester', {
                    taskId: task._id,
                    error: err instanceof Error ? err.message : 'Unknown error',
                  })
                );
              } else {
                logger.info('ReminderScheduler: Email notifications disabled for requester', {
                  taskId: task._id,
                  userId: requesterProfile.uid
                });
              }
            }
            if (assigneeProfile?.uid) {
              fireWhatsAppNotify({
                uid: assigneeProfile.uid,
                templateKey: 'wa_task_reminder',
                category: 'taskReminders',
                templateBody: {
                  var_1: task.title || 'your task',
                  var_2: scheduledDateStr || 'soon',
                },
                idempotencyKey: `wa_task_reminder:${task._id.toString()}:${assigneeProfile.uid}:24h:${scheduleVersion}`,
                metadata: {
                  workId: task._id.toString(),
                  triggerType: '24h',
                  recipientRole: 'helper',
                },
              });
            }

            if (assigneeProfile?.email && assigneeProfile?.uid) {
              // Check if user has enabled task reminder emails
              const { NotificationPreferenceChecker } = await import('../services/NotificationPreferenceChecker');
              const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                assigneeProfile.uid,
                'taskReminders'
              );
              
              if (emailEnabled) {
                EmailServiceClient.sendTaskReminder(assigneeProfile.email, {
                  recipientName: assigneeProfile.name || assigneeProfile.fullName || 'There',
                  taskTitle: task.title,
                  scheduledDate: scheduledDateStr,
                  scheduledTime: scheduledTimeStr,
                  location: locationStr,
                  isTasker: true,
                  otherPartyName: requesterProfile?.name || requesterProfile?.fullName,
                  taskUrl,
                  userId: assigneeProfile.uid,
                }).catch((err) =>
                  logger.error('ReminderScheduler: Error sending task_reminder email to assignee', {
                    taskId: task._id,
                    error: err instanceof Error ? err.message : 'Unknown error',
                  })
                );
              } else {
                logger.info('ReminderScheduler: Email notifications disabled for assignee', {
                  taskId: task._id,
                  userId: assigneeProfile.uid
                });
              }
            }
          } catch (emailErr) {
            logger.error('ReminderScheduler: Error sending task_reminder emails', {
              taskId: task._id,
              error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
            });
          }

          logger.info('ReminderScheduler: Reminder sent', {
            taskId: task._id,
            scheduledDate: task.scheduledDate?.toISOString(),
            recipientCount: recipients.length
          });
        } catch (error) {
          logger.error('ReminderScheduler: Error sending reminder', {
            taskId: task._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          // Continue with next task
          continue;
        }
      }

      logger.info('ReminderScheduler: Reminder job completed', {
        tasksProcessed: tasksNeedingReminders.length
      });
    } catch (error) {
      logger.error('ReminderScheduler: Error running reminder job', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Manual trigger for testing
   * 
   * @returns Number of reminders sent
   */
  static async sendRemindersNow(): Promise<number> {
    logger.info('ReminderScheduler: Manual trigger');
    
    try {
      const now = new Date();
      const lowerBound = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      const upperBound = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      const tasksNeedingReminders = await Task.find({
        scheduledDate: {
          $gte: lowerBound,
          $lte: upperBound
        },
        status: { $in: ['assigned', 'started'] }
      })
        .select('_id scheduledDate scheduledTimeStart scheduledTimeEnd requesterId assigneeId title location notificationGovernance')
        .lean();

      for (const task of tasksNeedingReminders) {
        try {
          const recipients: string[] = [task.requesterId.toString()];
          if (task.assigneeId && task.assigneeId.toString() !== task.requesterId.toString()) {
            recipients.push(task.assigneeId.toString());
          }

          await NotificationClient.send({
            eventKey: 'TASK_REMINDER_24H',
            category: 'taskReminders',
            recipients,
            entity: { type: 'task', id: task._id.toString() },
            title: `Reminder: "${task.title}" is coming up soon`,
            body: `Your task is scheduled for tomorrow. Make sure both of you are ready!`,
            data: {
              taskId: task._id.toString(),
              scheduledDate: task.scheduledDate?.toISOString()
            }
          });
        } catch (error) {
          logger.error('ReminderScheduler: Error in manual trigger', {
            taskId: task._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return tasksNeedingReminders.length;
    } catch (error) {
      logger.error('ReminderScheduler: Error in manual trigger', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }
}
