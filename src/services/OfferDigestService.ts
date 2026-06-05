import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import logger from '../config/logger';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import {
  isDigestEligibleTask,
  utcDayKey,
} from './notificationGovernance';

const DIGEST_MIN_PENDING = 3;
const DIGEST_MIN_HOURS = 4;
const DIGEST_COOLDOWN_HOURS = 2;
const MAX_DIGESTS_PER_WORK_PER_DAY = 3;
const REVIEW_RECENT_MINUTES = 30;

type OfferDigestState = {
  pendingSinceLastDigest?: number;
  lastDigestAt?: Date;
  digestsToday?: number;
  digestDayKey?: string;
  firstOfferWaSent?: boolean;
};

/**
 * Customer offer notifications: first applicant → wa_offer_received;
 * further applicants → batched wa_offers_digest with governance caps.
 */
export class OfferDigestService {
  /**
   * Call after a new pending application is saved.
   */
  static async onNewApplication(args: {
    taskId: string;
    applicationId: string;
    requesterUid: string;
    applicantDisplayName: string;
    taskTitle: string;
  }): Promise<void> {
    const task = await Task.findById(args.taskId).lean();
    if (!task) return;

    if (!isDigestEligibleTask({ status: task.status, assigneeId: task.assigneeId })) {
      return;
    }

    const pendingActive = await TaskApplication.countDocuments({
      taskId: args.taskId,
      status: 'pending',
    });

    if (pendingActive === 0) return;

    // Poster recently reviewed applicants — skip noisy WA (push/in-app may still fire elsewhere).
    const viewedAt = (task as { notificationGovernance?: { applicantsViewedAt?: Date } })
      .notificationGovernance?.applicantsViewedAt;
    if (viewedAt) {
      const mins = (Date.now() - new Date(viewedAt).getTime()) / 60_000;
      if (mins < REVIEW_RECENT_MINUTES && pendingActive > 1) {
        await this.bumpPendingOnly(args.taskId);
        return;
      }
    }

    if (pendingActive === 1) {
      fireWhatsAppNotify({
        uid: args.requesterUid,
        templateKey: 'wa_offer_received',
        category: 'taskUpdates',
        templateBody: {
          var_1: args.applicantDisplayName,
          var_2: args.taskTitle || 'your task',
        },
        idempotencyKey: `offer:${args.applicationId}`,
        metadata: {
          workId: args.taskId,
          triggerType: 'first_offer',
          recipientRole: 'customer',
        },
      });

      await Task.updateOne(
        { _id: args.taskId },
        {
          $set: {
            'notificationGovernance.offerDigest.firstOfferWaSent': true,
            'notificationGovernance.offerDigest.pendingSinceLastDigest': 0,
            'notificationGovernance.offerDigest.digestDayKey': utcDayKey(),
          },
        }
      );
      return;
    }

    await this.bumpPendingOnly(args.taskId);
    await this.trySendDigest({
      taskId: args.taskId,
      requesterUid: args.requesterUid,
      taskTitle: args.taskTitle || 'your task',
    });
  }

  private static async bumpPendingOnly(taskId: string): Promise<void> {
    await Task.updateOne(
      { _id: taskId },
      { $inc: { 'notificationGovernance.offerDigest.pendingSinceLastDigest': 1 } }
    );
  }

  /**
   * Attempt digest send when thresholds met (3 pending or 4h, cooldown 2h, caps).
   */
  static async trySendDigest(args: {
    taskId: string;
    requesterUid: string;
    taskTitle: string;
  }): Promise<void> {
    const task = await Task.findById(args.taskId).lean();
    if (!task) return;

    if (!isDigestEligibleTask({ status: task.status, assigneeId: task.assigneeId })) {
      return;
    }

    const pendingActive = await TaskApplication.countDocuments({
      taskId: args.taskId,
      status: 'pending',
    });
    if (pendingActive < 1) return;

    const digest = (task as { notificationGovernance?: { offerDigest?: OfferDigestState } })
      .notificationGovernance?.offerDigest ?? {};

    const dayKey = utcDayKey();
    let digestsToday = digest.digestsToday ?? 0;
    if (digest.digestDayKey !== dayKey) {
      digestsToday = 0;
    }
    if (digestsToday >= MAX_DIGESTS_PER_WORK_PER_DAY) return;

    const pendingSince = digest.pendingSinceLastDigest ?? 0;
    const lastDigestAt = digest.lastDigestAt ? new Date(digest.lastDigestAt) : null;
    const hoursSinceDigest = lastDigestAt
      ? (Date.now() - lastDigestAt.getTime()) / 3_600_000
      : Number.POSITIVE_INFINITY;

    if (hoursSinceDigest < DIGEST_COOLDOWN_HOURS) return;

    const shouldSend =
      pendingSince >= DIGEST_MIN_PENDING || hoursSinceDigest >= DIGEST_MIN_HOURS;
    if (!shouldSend) return;

    const digestIndex = digestsToday + 1;
    const idempotencyKey = `wa_offers_digest:${args.taskId}:${args.requesterUid}:${dayKey}:${digestIndex}`;

    fireWhatsAppNotify({
      uid: args.requesterUid,
      templateKey: 'wa_offers_digest',
      category: 'taskUpdates',
      templateBody: {
        var_1: String(pendingActive),
        var_2: args.taskTitle,
      },
      idempotencyKey,
      metadata: {
        workId: args.taskId,
        triggerType: 'digest',
        recipientRole: 'customer',
        pendingCount: pendingActive,
      },
    });

    await Task.updateOne(
      { _id: args.taskId },
      {
        $set: {
          'notificationGovernance.offerDigest.pendingSinceLastDigest': 0,
          'notificationGovernance.offerDigest.lastDigestAt': new Date(),
          'notificationGovernance.offerDigest.digestsToday': digestIndex,
          'notificationGovernance.offerDigest.digestDayKey': dayKey,
        },
      }
    );

    logger.info('[OfferDigestService] digest queued', {
      taskId: args.taskId,
      pendingActive,
      digestIndex,
    });
  }

  /** Poster opened applicants list — suppress digest spam for 30 minutes. */
  static async markApplicantsViewed(taskId: string, requesterProfileId: mongoose.Types.ObjectId): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task || !task.requesterId.equals(requesterProfileId)) return;

    await Task.updateOne(
      { _id: taskId },
      { $set: { 'notificationGovernance.applicantsViewedAt': new Date() } }
    );
  }
}
