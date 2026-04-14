import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import Review from '../models/Review';
import TaskFollow from '../models/TaskFollow';
import TaskReport from '../models/TaskReport';
import TaskQuestion from '../models/TaskQuestion';
import logger from '../config/logger';

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

