import cron from 'node-cron';
import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import logger from '../config/logger';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { isDigestEligibleTask } from '../services/notificationGovernance';

/**
 * Once per application: remind helper that work is still open 24h after apply.
 */
export class ApplicationFollowUpScheduler {
  private static isInitialized = false;

  static async initialize(serviceName: string = 'task-service'): Promise<void> {
    if (this.isInitialized) return;

    cron.schedule('0 * * * *', async () => {
      await this.runJob();
    });

    this.isInitialized = true;
    logger.info('ApplicationFollowUpScheduler initialized', { serviceName });
  }

  private static async runJob(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const applications = await TaskApplication.find({
      status: 'pending',
      createdAt: { $lte: cutoff },
    })
      .select('_id taskId applicantId applicantUid createdAt')
      .limit(200)
      .lean();

    const Profile = mongoose.connection.collection('profiles');

    for (const app of applications) {
      try {
        const task = await Task.findById(app.taskId)
          .select('_id title status assigneeId requesterId')
          .lean();
        if (!task) continue;
        if (!isDigestEligibleTask({ status: task.status, assigneeId: task.assigneeId })) {
          continue;
        }

        const applicantProfile = await Profile.findOne({ _id: app.applicantId });
        const helperUid = applicantProfile?.uid
          ? String(applicantProfile.uid)
          : app.applicantUid;
        if (!helperUid) continue;

        fireWhatsAppNotify({
          uid: helperUid,
          templateKey: 'wa_application_still_open',
          category: 'taskUpdates',
          templateBody: { var_1: task.title || 'your task' },
          idempotencyKey: `wa_application_still_open:${app._id}`,
          metadata: {
            workId: String(task._id),
            applicationId: String(app._id),
            triggerType: '24h_followup',
            recipientRole: 'helper',
          },
        });
      } catch (err) {
        logger.warn('ApplicationFollowUpScheduler: row failed', {
          applicationId: app._id,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }
}
