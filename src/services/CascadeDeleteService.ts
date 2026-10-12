import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import Review from '../models/Review';
import TaskFollow from '../models/TaskFollow';
import TaskReport from '../models/TaskReport';
import TaskQuestion from '../models/TaskQuestion';
import logger from '../config/logger';
import { BadRequestError } from '../errors/AppError';
import { AssignmentService } from './AssignmentService';

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
  static async getAccountDeletionPreview(
    profileIdStr: string,
    deletionScope: string = 'full',
    uid?: string,
  ): Promise<{
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
    const scope = String(deletionScope || 'full').trim().toLowerCase();
    const includePosterTasks =
      scope === 'full' || scope === 'poster-scoped' || scope === 'customer-scoped';

    const [
      openTasksCount,
      completedTasksCount,
      cancelledTasksCount,
      applicationsCount,
      blockers,
    ] = await Promise.all([
      includePosterTasks
        ? Task.countDocuments({ requesterId: profileId, status: 'open' })
        : Promise.resolve(0),
      includePosterTasks
        ? Task.countDocuments({ requesterId: profileId, status: 'completed' })
        : Promise.resolve(0),
      includePosterTasks
        ? Task.countDocuments({ requesterId: profileId, status: 'cancelled' })
        : Promise.resolve(0),
      scope === 'partner-account'
        ? Promise.resolve(0)
        : TaskApplication.countDocuments({ applicantId: profileId }),
      this.getActiveDeletionBlockers(profileIdStr, deletionScope, uid),
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
   * Delete task data eligible for account deletion.
   * Scope:
   * - full: poster tasks + helper applications + shared reviews/follows/reports/questions
   * - poster-scoped: poster tasks (+ apps on those tasks) only — keep helper applications/reputation
   * - helper-scoped: helper applications only — keep poster tasks
   * - partner-account: remove Helper data, but only block on active Partner bookings
   */
  static async deleteAccountEligibleData(
    uid: string,
    profileIdStr?: string,
    deletionScope: string = 'full',
  ): Promise<{
    tasksDeleted: number;
    applicationsDeleted: number;
    reviewsDeleted: number;
    followsDeleted: number;
    reportsDeleted: number;
    questionsDeleted: number;
    totalDeleted: number;
  }> {
    const scope = String(deletionScope || 'full').trim().toLowerCase();
    const isPosterScoped = scope === 'poster-scoped' || scope === 'customer-scoped';
    const isPartnerAccount = scope === 'partner-account';
    const isHelperScoped =
      scope === 'helper-scoped' || scope === 'role-scoped' || isPartnerAccount;
    const isFull = !isPosterScoped && !isHelperScoped;

    const profileId = profileIdStr && mongoose.Types.ObjectId.isValid(profileIdStr)
      ? new mongoose.Types.ObjectId(profileIdStr)
      : null;

    logger.info(`🗑️ Starting account-deletion eligible delete for user: ${uid}`, {
      profileId: profileId?.toString() ?? 'not provided',
      deletionScope: scope,
    });

    try {
      if (profileId) {
        const blockers = await this.getActiveDeletionBlockers(profileIdStr!, scope, uid);
        if (blockers.hasBlockers) {
          throw new BadRequestError(
            'Account cannot be deleted while user has ongoing assigned work.',
          );
        }
      }

      let taskIds: mongoose.Types.ObjectId[] = [];
      let tasksDeleteResult = { deletedCount: 0 };
      let applicationsDeleteResult = { deletedCount: 0 };
      let orphanedApplicationsResult = { deletedCount: 0 };
      let reviewsDeleteResult = { deletedCount: 0 };
      let followsDeleteResult = { deletedCount: 0 };
      let reportsDeleteResult = { deletedCount: 0 };
      let questionsDeleteResult = { deletedCount: 0 };
      let assigneeLinksCleared = 0;

      if (profileId) {
        if (isFull || isPosterScoped) {
          const deletablePosterTasks = await Task.find({
            requesterId: profileId,
            status: { $in: [...ACCOUNT_DELETION_DELETABLE_POSTER_STATUSES] },
          }).select('_id').lean();

          taskIds = deletablePosterTasks.map((task) => task._id);
          logger.info(`📋 Found ${taskIds.length} deletable poster tasks for profileId ${profileId}`);

          if (taskIds.length > 0) {
            orphanedApplicationsResult = await TaskApplication.deleteMany({ taskId: { $in: taskIds } });
            logger.info(`✅ Deleted ${orphanedApplicationsResult.deletedCount} applications on deleted poster tasks`);

            tasksDeleteResult = await Task.deleteMany({ _id: { $in: taskIds } });
            logger.info(`✅ Deleted ${tasksDeleteResult.deletedCount} poster tasks (open/completed/cancelled)`);
          }
        }

        if (isFull || isHelperScoped) {
          if (isPartnerAccount) {
            const activePartnerAssignment = {
              $and: [
                {
                  $or: [
                    { partnerId: { $exists: true, $ne: null } },
                    { partnerUid: { $exists: true, $nin: [null, ''] } },
                  ],
                },
                { status: { $in: [...ACTIVE_DELETION_BLOCKER_STATUSES] } },
              ],
            };
            const activeHelperTasks = await Task.find({
              assigneeId: profileId,
              status: { $in: [...ACTIVE_DELETION_BLOCKER_STATUSES] },
              $nor: [activePartnerAssignment],
            })
              .select('_id')
              .lean();

            for (const task of activeHelperTasks) {
              await AssignmentService.unassignHelper({
                taskId: String(task._id),
                unassignedByUid: uid,
              });
            }

            logger.info('Released active Helper assignments during Partner account deletion', {
              uid,
              count: activeHelperTasks.length,
            });
          }

          applicationsDeleteResult = await TaskApplication.deleteMany({ applicantId: profileId });
          logger.info(`✅ Deleted ${applicationsDeleteResult.deletedCount} task applications (by applicantId)`);

          const taskAssignmentClearResult = await Task.updateMany(
            {
              assigneeId: profileId,
              ...(isPartnerAccount
                ? {
                    $nor: [
                      {
                        $and: [
                          {
                            $or: [
                              { partnerId: { $exists: true, $ne: null } },
                              { partnerUid: { $exists: true, $nin: [null, ''] } },
                            ],
                          },
                          { status: { $in: [...ACTIVE_DELETION_BLOCKER_STATUSES] } },
                        ],
                      },
                    ],
                  }
                : {}),
            },
            {
              $unset: {
                assigneeId: '',
                assigneeUid: '',
                assignedAt: '',
                assignedHelperName: '',
                assignedToName: '',
                assigneeName: '',
                acceptedApplicationId: '',
                ...(isPartnerAccount
                  ? {
                      partnerId: '',
                      partnerUid: '',
                      partnerAcceptedAt: '',
                      confirmed: '',
                      confirmedAt: '',
                      confirmed_at: '',
                    }
                  : {}),
              },
            },
          );
          assigneeLinksCleared = taskAssignmentClearResult.modifiedCount || 0;
          logger.info(`✅ Cleared assignee links from ${assigneeLinksCleared} tasks for helper/partner role`);

          if (isPartnerAccount) {
            const completedPartnerLinks = await Task.updateMany(
              {
                status: { $nin: [...ACTIVE_DELETION_BLOCKER_STATUSES] },
                $or: [{ partnerId: profileId }, { partnerUid: uid }],
              },
              {
                $unset: {
                  assigneeId: '',
                  assigneeUid: '',
                  assignedAt: '',
                  assignedHelperName: '',
                  assignedToName: '',
                  assigneeName: '',
                  acceptedApplicationId: '',
                  partnerId: '',
                  partnerUid: '',
                  partnerAcceptedAt: '',
                  confirmed: '',
                  confirmedAt: '',
                  confirmed_at: '',
                },
              },
            );
            logger.info('✅ Cleared completed Partner booking links during account deletion', {
              uid,
              modifiedCount: completedPartnerLinks.modifiedCount || 0,
            });
          }
        }

        // Shared reputation/audit records: only wipe on full account delete.
        if (isFull || isPartnerAccount) {
          reviewsDeleteResult = await Review.deleteMany({
            $or: [{ reviewerId: profileId }, { reviewedId: profileId }],
          });
          logger.info(`✅ Deleted ${reviewsDeleteResult.deletedCount} reviews`);

          followsDeleteResult = await TaskFollow.deleteMany({ userId: uid });
          logger.info(`✅ Deleted ${followsDeleteResult.deletedCount} task follows`);

          reportsDeleteResult = await TaskReport.deleteMany({ userId: profileId });
          logger.info(`✅ Deleted ${reportsDeleteResult.deletedCount} task reports`);

          questionsDeleteResult = await TaskQuestion.deleteMany({
            $or: [{ askedById: profileId }, { answeredById: profileId }],
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

        logger.info(`✅ Account-deletion eligible delete completed for user ${uid}. Total records deleted: ${totalDeleted}`, {
          deletionScope: scope,
          assigneeLinksCleared,
        });

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
   * Scope limits which side is checked (poster vs assignee).
   */
  static async getActiveDeletionBlockers(
    profileIdStr: string,
    deletionScope: string = 'full',
    uid?: string,
  ): Promise<{
    hasBlockers: boolean;
    asPosterCount: number;
    asAssigneeCount: number;
    sampleTasks: Array<{ id: string; title: string; status: string; role: 'poster' | 'assignee' }>;
  }> {
    if (!profileIdStr || !mongoose.Types.ObjectId.isValid(profileIdStr)) {
      throw new BadRequestError('Valid profileId is required for deletion blocker check');
    }

    const scope = String(deletionScope || 'full').trim().toLowerCase();
    const checkPartner = scope === 'partner-account';
    const checkPoster =
      !checkPartner &&
      (scope === 'full' || scope === 'poster-scoped' || scope === 'customer-scoped');
    const checkAssignee =
      !checkPartner &&
      (scope === 'full' || scope === 'helper-scoped' || scope === 'role-scoped');

    const profileId = new mongoose.Types.ObjectId(profileIdStr);
    const statuses = [...ACTIVE_DELETION_BLOCKER_STATUSES];
    const partnerFilter = {
      status: { $in: statuses },
      $or: [{ partnerId: profileId }, ...(uid ? [{ partnerUid: uid }] : [])],
    };

    const [asPosterCount, asAssigneeCount, partnerCount, posterSample, assigneeSample, partnerSample] = await Promise.all([
      checkPoster
        ? Task.countDocuments({ requesterId: profileId, status: { $in: statuses } })
        : Promise.resolve(0),
      checkAssignee
        ? Task.countDocuments({ assigneeId: profileId, status: { $in: statuses } })
        : Promise.resolve(0),
      checkPartner ? Task.countDocuments(partnerFilter) : Promise.resolve(0),
      checkPoster
        ? Task.find({ requesterId: profileId, status: { $in: statuses } })
            .select('_id title status')
            .limit(3)
            .lean()
        : Promise.resolve([] as any[]),
      checkAssignee
        ? Task.find({ assigneeId: profileId, status: { $in: statuses } })
            .select('_id title status')
            .limit(3)
            .lean()
        : Promise.resolve([] as any[]),
      checkPartner
        ? Task.find(partnerFilter).select('_id title status').limit(3).lean()
        : Promise.resolve([] as any[]),
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
      ...partnerSample.map((t) => ({
        id: String(t._id),
        title: String(t.title || ''),
        status: String(t.status),
        role: 'assignee' as const,
      })),
    ];

    const blockingAssigneeCount = checkPartner ? partnerCount : asAssigneeCount;
    return {
      hasBlockers: asPosterCount > 0 || blockingAssigneeCount > 0,
      asPosterCount,
      asAssigneeCount: blockingAssigneeCount,
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
