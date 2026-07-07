import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import Review from '../models/Review';
import TaskFollow from '../models/TaskFollow';
import TaskReport from '../models/TaskReport';
import TaskQuestion from '../models/TaskQuestion';
import logger from '../config/logger';
import { BadRequestError } from '../errors/AppError';

/** Task statuses that block account deletion until completed or cancelled. */
export const ACTIVE_DELETION_BLOCKER_STATUSES = [
  'assigned',
  'started',
  'in_progress',
  'review',
] as const;

/** Poster-owned tasks removed on account deletion (active tasks are blocked instead). */
export const ACCOUNT_DELETION_DELETABLE_POSTER_STATUSES = [
  'open',
  'completed',
  'cancelled',
] as const;

export class CascadeDeleteService {
  /**
   * Delete only open posted tasks for a user.
   * Used by user-service before account deletion so open tasks are removed first.
   */
  static async deleteOpenPostedTasks(uid: string, profileIdStr?: string): Promise<{
    tasksDeleted: number;
    applicationsDeleted: number;
    totalDeleted: number;
  }> {
    const profileId = profileIdStr && mongoose.Types.ObjectId.isValid(profileIdStr)
      ? new mongoose.Types.ObjectId(profileIdStr)
      : null;

    logger.info(`🗑️ Starting open-task delete for user: ${uid}, profileId: ${profileId?.toString() ?? 'not provided'}`);

    try {
      if (!profileId) {
        logger.warn(`⚠️ No valid profileId provided; skipping open task deletion`);
        return { tasksDeleted: 0, applicationsDeleted: 0, totalDeleted: 0 };
      }

      const openTasks = await Task.find({ requesterId: profileId, status: 'open' }).select('_id').lean();
      const taskIds = openTasks.map((task) => task._id);
      logger.info(`📋 Found ${taskIds.length} open tasks to delete for profileId ${profileId}`);

      let tasksDeleted = 0;
      let applicationsDeleted = 0;

      if (taskIds.length > 0) {
        const taskDeleteResult = await Task.deleteMany({ _id: { $in: taskIds } });
        tasksDeleted = taskDeleteResult.deletedCount || 0;
        logger.info(`✅ Deleted ${tasksDeleted} open tasks`);

        const applicationDeleteResult = await TaskApplication.deleteMany({ taskId: { $in: taskIds } });
        applicationsDeleted = applicationDeleteResult.deletedCount || 0;
        logger.info(`✅ Deleted ${applicationsDeleted} applications linked to deleted open tasks`);
      }

      const totalDeleted = tasksDeleted + applicationsDeleted;
      logger.info(`✅ Open-task delete completed for user ${uid}. Total records deleted: ${totalDeleted}`);

      return {
        tasksDeleted,
        applicationsDeleted,
        totalDeleted
      };
    } catch (error: any) {
      logger.error(`❌ Error during open-task delete for user ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Delete all data associated with a user.
   * Uses uid (Firebase UID) for TaskFollow; uses profileId (Profile ObjectId) for Task, TaskApplication,
   * Review, TaskReport, TaskQuestion when provided.
   */
  static async deleteUserData(uid: string, profileIdStr?: string): Promise<{
    tasksDeleted: number;
    applicationsDeleted: number;
    reviewsDeleted: number;
    followsDeleted: number;
    reportsDeleted: number;
    questionsDeleted: number;
    totalDeleted: number;
  }> {
    const profileId = profileIdStr && mongoose.Types.ObjectId.isValid(profileIdStr)
      ? new mongoose.Types.ObjectId(profileIdStr)
      : null;

    logger.info(`🗑️ Starting cascading delete for user: ${uid}, profileId: ${profileId?.toString() ?? 'not provided'}`);

    try {
      let taskIds: mongoose.Types.ObjectId[] = [];
      let tasksDeleteResult = { deletedCount: 0 };

      if (profileId) {
        // 1. Find tasks where user is requester (poster) or assignee (performer) by profile ObjectId
        const tasksToDelete = await Task.find({
          $or: [
            { requesterId: profileId },
            { assigneeId: profileId }
          ]
        }).select('_id').lean();

        taskIds = tasksToDelete.map(t => t._id);
        logger.info(`📋 Found ${taskIds.length} tasks to delete for profileId ${profileId}`);

        if (taskIds.length > 0) {
          tasksDeleteResult = await Task.deleteMany({ _id: { $in: taskIds } });
          logger.info(`✅ Deleted ${tasksDeleteResult.deletedCount} tasks`);
        }
      } else {
        logger.warn(`⚠️ No profileId provided; skipping task deletion (tasks are keyed by profile ObjectId)`);
      }

      // 2. Delete task applications by this user (applicantId = profileId) or orphaned by deleted tasks
      let applicationsDeleteResult = { deletedCount: 0 };
      if (profileId) {
        applicationsDeleteResult = await TaskApplication.deleteMany({
          applicantId: profileId
        });
        logger.info(`✅ Deleted ${applicationsDeleteResult.deletedCount} task applications (by applicantId)`);
      }
      let orphanedApplicationsResult = { deletedCount: 0 };
      if (taskIds.length > 0) {
        orphanedApplicationsResult = await TaskApplication.deleteMany({
          taskId: { $in: taskIds }
        });
        logger.info(`✅ Deleted ${orphanedApplicationsResult.deletedCount} orphaned applications`);
      }

      // 3. Delete reviews by or about this user (reviewerId / reviewedId = profileId)
      let reviewsDeleteResult = { deletedCount: 0 };
      if (profileId) {
        reviewsDeleteResult = await Review.deleteMany({
          $or: [
            { reviewerId: profileId },
            { reviewedId: profileId }
          ]
        });
        logger.info(`✅ Deleted ${reviewsDeleteResult.deletedCount} reviews`);
      }

      // 4. Task follows are keyed by uid (string)
      const followsDeleteResult = await TaskFollow.deleteMany({ userId: uid });
      logger.info(`✅ Deleted ${followsDeleteResult.deletedCount} task follows`);

      // 5. Task reports: userId is profile ObjectId
      let reportsDeleteResult = { deletedCount: 0 };
      if (profileId) {
        reportsDeleteResult = await TaskReport.deleteMany({ userId: profileId });
        logger.info(`✅ Deleted ${reportsDeleteResult.deletedCount} task reports`);
      }

      // 6. Task questions: askedById / answeredById = profileId
      let questionsDeleteResult = { deletedCount: 0 };
      if (profileId) {
        questionsDeleteResult = await TaskQuestion.deleteMany({
          $or: [
            { askedById: profileId },
            { answeredById: profileId }
          ]
        });
        logger.info(`✅ Deleted ${questionsDeleteResult.deletedCount} task questions`);
      }

      const totalDeleted =
        tasksDeleteResult.deletedCount +
        applicationsDeleteResult.deletedCount +
        orphanedApplicationsResult.deletedCount +
        reviewsDeleteResult.deletedCount +
        followsDeleteResult.deletedCount +
        reportsDeleteResult.deletedCount +
        questionsDeleteResult.deletedCount;

      logger.info(`✅ Cascading delete completed for user ${uid}. Total records deleted: ${totalDeleted}`);

      return {
        tasksDeleted: tasksDeleteResult.deletedCount,
        applicationsDeleted: applicationsDeleteResult.deletedCount + orphanedApplicationsResult.deletedCount,
        reviewsDeleted: reviewsDeleteResult.deletedCount,
        followsDeleted: followsDeleteResult.deletedCount,
        reportsDeleted: reportsDeleteResult.deletedCount,
        questionsDeleted: questionsDeleteResult.deletedCount,
        totalDeleted
      };
    } catch (error: any) {
      logger.error(`❌ Error during cascading delete for user ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Preview counts for account deletion warnings (open/completed/cancelled poster tasks + applications).
   */
  static async getAccountDeletionPreview(profileIdStr: string): Promise<{
    hasActiveBlockers: boolean;
    openTasksCount: number;
    completedTasksCount: number;
    cancelledTasksCount: number;
    applicationsCount: number;
    asPosterActiveCount: number;
    asAssigneeActiveCount: number;
  }> {
    if (!profileIdStr || !mongoose.Types.ObjectId.isValid(profileIdStr)) {
      throw new BadRequestError('Valid profileId is required for account deletion preview');
    }

    const profileId = new mongoose.Types.ObjectId(profileIdStr);

    const [
      openTasksCount,
      completedTasksCount,
      cancelledTasksCount,
      applicationsCount,
      blockers,
    ] = await Promise.all([
      Task.countDocuments({ requesterId: profileId, status: 'open' }),
      Task.countDocuments({ requesterId: profileId, status: 'completed' }),
      Task.countDocuments({ requesterId: profileId, status: 'cancelled' }),
      TaskApplication.countDocuments({ applicantId: profileId }),
      this.getActiveDeletionBlockers(profileIdStr),
    ]);

    return {
      hasActiveBlockers: blockers.hasBlockers,
      openTasksCount,
      completedTasksCount,
      cancelledTasksCount,
      applicationsCount,
      asPosterActiveCount: blockers.asPosterCount,
      asAssigneeActiveCount: blockers.asAssigneeCount,
    };
  }

  /**
   * Delete task data eligible for account deletion: poster tasks in open/completed/cancelled,
   * all user applications/offers, and related reviews/follows/reports/questions.
   * Does not delete active/ongoing tasks (caller must block on those first).
   */
  static async deleteAccountEligibleData(uid: string, profileIdStr?: string): Promise<{
    tasksDeleted: number;
    applicationsDeleted: number;
    reviewsDeleted: number;
    followsDeleted: number;
    reportsDeleted: number;
    questionsDeleted: number;
    totalDeleted: number;
  }> {
    const profileId = profileIdStr && mongoose.Types.ObjectId.isValid(profileIdStr)
      ? new mongoose.Types.ObjectId(profileIdStr)
      : null;

    logger.info(`🗑️ Starting account-deletion eligible delete for user: ${uid}, profileId: ${profileId?.toString() ?? 'not provided'}`);

    try {
      if (profileId) {
        const blockers = await this.getActiveDeletionBlockers(profileIdStr!);
        if (blockers.hasBlockers) {
          throw new BadRequestError(
            'Account cannot be deleted while user has ongoing assigned work.',
          );
        }
      }

      let taskIds: mongoose.Types.ObjectId[] = [];
      let tasksDeleteResult = { deletedCount: 0 };

      if (profileId) {
        const deletablePosterTasks = await Task.find({
          requesterId: profileId,
          status: { $in: [...ACCOUNT_DELETION_DELETABLE_POSTER_STATUSES] },
        }).select('_id').lean();

        taskIds = deletablePosterTasks.map((task) => task._id);
        logger.info(`📋 Found ${taskIds.length} deletable poster tasks for profileId ${profileId}`);

        let applicationsDeleteResult = { deletedCount: 0 };
        applicationsDeleteResult = await TaskApplication.deleteMany({ applicantId: profileId });
        logger.info(`✅ Deleted ${applicationsDeleteResult.deletedCount} task applications (by applicantId)`);

        let orphanedApplicationsResult = { deletedCount: 0 };
        if (taskIds.length > 0) {
          orphanedApplicationsResult = await TaskApplication.deleteMany({ taskId: { $in: taskIds } });
          logger.info(`✅ Deleted ${orphanedApplicationsResult.deletedCount} applications on deleted poster tasks`);

          tasksDeleteResult = await Task.deleteMany({ _id: { $in: taskIds } });
          logger.info(`✅ Deleted ${tasksDeleteResult.deletedCount} poster tasks (open/completed/cancelled)`);
        }

        let reviewsDeleteResult = { deletedCount: 0 };
        reviewsDeleteResult = await Review.deleteMany({
          $or: [{ reviewerId: profileId }, { reviewedId: profileId }],
        });
        logger.info(`✅ Deleted ${reviewsDeleteResult.deletedCount} reviews`);

        const followsDeleteResult = await TaskFollow.deleteMany({ userId: uid });
        logger.info(`✅ Deleted ${followsDeleteResult.deletedCount} task follows`);

        let reportsDeleteResult = { deletedCount: 0 };
        reportsDeleteResult = await TaskReport.deleteMany({ userId: profileId });
        logger.info(`✅ Deleted ${reportsDeleteResult.deletedCount} task reports`);

        let questionsDeleteResult = { deletedCount: 0 };
        questionsDeleteResult = await TaskQuestion.deleteMany({
          $or: [{ askedById: profileId }, { answeredById: profileId }],
        });
        logger.info(`✅ Deleted ${questionsDeleteResult.deletedCount} task questions`);

        const totalDeleted =
          tasksDeleteResult.deletedCount +
          applicationsDeleteResult.deletedCount +
          orphanedApplicationsResult.deletedCount +
          reviewsDeleteResult.deletedCount +
          followsDeleteResult.deletedCount +
          reportsDeleteResult.deletedCount +
          questionsDeleteResult.deletedCount;

        logger.info(`✅ Account-deletion eligible delete completed for user ${uid}. Total records deleted: ${totalDeleted}`);

        return {
          tasksDeleted: tasksDeleteResult.deletedCount,
          applicationsDeleted: applicationsDeleteResult.deletedCount + orphanedApplicationsResult.deletedCount,
          reviewsDeleted: reviewsDeleteResult.deletedCount,
          followsDeleted: followsDeleteResult.deletedCount,
          reportsDeleted: reportsDeleteResult.deletedCount,
          questionsDeleted: questionsDeleteResult.deletedCount,
          totalDeleted,
        };
      }

      logger.warn(`⚠️ No profileId provided; skipping account-deletion eligible delete`);
      return {
        tasksDeleted: 0,
        applicationsDeleted: 0,
        reviewsDeleted: 0,
        followsDeleted: 0,
        reportsDeleted: 0,
        questionsDeleted: 0,
        totalDeleted: 0,
      };
    } catch (error: any) {
      logger.error(`❌ Error during account-deletion eligible delete for user ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Returns whether the user has tasks that block account deletion.
   * Uses requesterId / assigneeId (profile ObjectId) — not posterUid (not stored on Task).
   */
  static async getActiveDeletionBlockers(profileIdStr: string): Promise<{
    hasBlockers: boolean;
    asPosterCount: number;
    asAssigneeCount: number;
    sampleTasks: Array<{ id: string; title: string; status: string; role: 'poster' | 'assignee' }>;
  }> {
    if (!profileIdStr || !mongoose.Types.ObjectId.isValid(profileIdStr)) {
      throw new BadRequestError('Valid profileId is required for deletion blocker check');
    }

    const profileId = new mongoose.Types.ObjectId(profileIdStr);
    const statuses = [...ACTIVE_DELETION_BLOCKER_STATUSES];

    const [asPosterCount, asAssigneeCount, posterSample, assigneeSample] = await Promise.all([
      Task.countDocuments({ requesterId: profileId, status: { $in: statuses } }),
      Task.countDocuments({ assigneeId: profileId, status: { $in: statuses } }),
      Task.find({ requesterId: profileId, status: { $in: statuses } })
        .select('_id title status')
        .limit(3)
        .lean(),
      Task.find({ assigneeId: profileId, status: { $in: statuses } })
        .select('_id title status')
        .limit(3)
        .lean(),
    ]);

    const sampleTasks = [
      ...posterSample.map((t) => ({
        id: String(t._id),
        title: String(t.title || ''),
        status: String(t.status),
        role: 'poster' as const,
      })),
      ...assigneeSample.map((t) => ({
        id: String(t._id),
        title: String(t.title || ''),
        status: String(t.status),
        role: 'assignee' as const,
      })),
    ];

    return {
      hasBlockers: asPosterCount > 0 || asAssigneeCount > 0,
      asPosterCount,
      asAssigneeCount,
      sampleTasks,
    };
  }

  /**
   * Diagnostic: Get all tasks for a user (both as poster and as assignee)
   * Helps debug why deletion is blocked
   */
  static async getUserTasksDiagnostic(uid: string, profileIdStr?: string) {
    logger.info(`🔍 Fetching all tasks for user ${uid}`, { profileId: profileIdStr });

    const profileId = profileIdStr ? new mongoose.Types.ObjectId(profileIdStr) : undefined;

    try {
      // Get all tasks where user is poster
      const posterTasks = await Task.find({ requesterId: profileId })
        .select('_id title status requesterId assigneeId createdAt assignedAt')
        .lean();

      // Get all tasks where user is assigned
      const assignedTasks = await Task.find({ assigneeId: profileId })
        .select('_id title status requesterId assigneeId createdAt assignedAt')
        .lean();

      // Get all applications where user is applicant
      const applications = await TaskApplication.find({ applicantId: profileId })
        .select('_id taskId applicantId status createdAt')
        .lean();

      logger.info(`📊 Task diagnostic result:`, {
        posterTasksCount: posterTasks.length,
        assignedTasksCount: assignedTasks.length,
        applicationsCount: applications.length,
        posterTasksStatus: posterTasks.map(t => ({ id: t._id, title: t.title, status: t.status })),
        assignedTasksStatus: assignedTasks.map(t => ({ id: t._id, title: t.title, status: t.status })),
        applicationsStatus: applications.map(a => ({ id: a._id, taskId: a.taskId, status: a.status }))
      });

      return {
        posterTasks: posterTasks.map(t => ({
          id: t._id,
          title: t.title,
          status: t.status,
          role: 'poster',
          createdAt: t.createdAt,
          assignedAt: t.assignedAt
        })),
        assignedTasks: assignedTasks.map(t => ({
          id: t._id,
          title: t.title,
          status: t.status,
          role: 'assignee',
          createdAt: t.createdAt,
          assignedAt: t.assignedAt
        })),
        applications: applications.map(a => ({
          id: a._id,
          taskId: a.taskId,
          status: a.status,
          createdAt: a.createdAt
        }))
      };
    } catch (error: any) {
      logger.error(`❌ Error fetching task diagnostic for user ${uid}:`, error);
      throw error;
    }
  }
}

