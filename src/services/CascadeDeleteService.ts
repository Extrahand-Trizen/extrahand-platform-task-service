import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import Review from '../models/Review';
import TaskFollow from '../models/TaskFollow';
import TaskReport from '../models/TaskReport';
import TaskQuestion from '../models/TaskQuestion';
import logger from '../config/logger';

export class CascadeDeleteService {
  /**
   * Delete all data associated with a user ID
   * This includes:
   * - Tasks where user is requester (poster) or assignee (performer)
   * - Task applications by the user
   * - Reviews by or about the user
   * - Task follows by the user
   * - Task reports by the user
   * - Task questions asked or answered by the user
   */
  static async deleteUserData(uid: string): Promise<{
    tasksDeleted: number;
    applicationsDeleted: number;
    reviewsDeleted: number;
    followsDeleted: number;
    reportsDeleted: number;
    questionsDeleted: number;
    totalDeleted: number;
  }> {
    logger.info(`🗑️ Starting cascading delete for user: ${uid}`);

    try {
      // 1. Find all tasks where user is requester (poster) or assignee (performer)
      const tasksToDelete = await Task.find({
        $or: [
          { requesterId: uid },
          { assigneeUid: uid }
        ]
      }).select('_id').lean();

      const taskIds = tasksToDelete.map(task => task._id);
      const tasksDeleted = tasksToDelete.length;

      logger.info(`📋 Found ${tasksDeleted} tasks to delete for user ${uid}`);

      // 2. Delete tasks (this will cascade to related data via application deletion)
      let tasksDeleteResult;
      if (taskIds.length > 0) {
        tasksDeleteResult = await Task.deleteMany({
          _id: { $in: taskIds }
        });
        logger.info(`✅ Deleted ${tasksDeleteResult.deletedCount} tasks`);
      } else {
        tasksDeleteResult = { deletedCount: 0 };
      }

      // 3. Delete task applications by this user
      const applicationsDeleteResult = await TaskApplication.deleteMany({
        applicantUid: uid
      });
      logger.info(`✅ Deleted ${applicationsDeleteResult.deletedCount} task applications`);

      // 4. Delete reviews by or about this user
      const reviewsDeleteResult = await Review.deleteMany({
        $or: [
          { reviewerUid: uid },
          { reviewedUid: uid }
        ]
      });
      logger.info(`✅ Deleted ${reviewsDeleteResult.deletedCount} reviews`);

      // 5. Delete task follows by this user
      const followsDeleteResult = await TaskFollow.deleteMany({
        userId: uid
      });
      logger.info(`✅ Deleted ${followsDeleteResult.deletedCount} task follows`);

      // 6. Delete task reports by this user
      const reportsDeleteResult = await TaskReport.deleteMany({
        userId: uid
      });
      logger.info(`✅ Deleted ${reportsDeleteResult.deletedCount} task reports`);

      // 7. Delete task questions asked or answered by this user
      const questionsDeleteResult = await TaskQuestion.deleteMany({
        $or: [
          { askedByUid: uid },
          { answeredByUid: uid }
        ]
      });
      logger.info(`✅ Deleted ${questionsDeleteResult.deletedCount} task questions`);

      // 8. Also delete applications for tasks that were deleted
      let orphanedApplicationsResult = { deletedCount: 0 };
      if (taskIds.length > 0) {
        orphanedApplicationsResult = await TaskApplication.deleteMany({
          taskId: { $in: taskIds }
        });
        logger.info(`✅ Deleted ${orphanedApplicationsResult.deletedCount} orphaned applications`);
      }

      const totalDeleted = 
        tasksDeleteResult.deletedCount +
        applicationsDeleteResult.deletedCount +
        reviewsDeleteResult.deletedCount +
        followsDeleteResult.deletedCount +
        reportsDeleteResult.deletedCount +
        questionsDeleteResult.deletedCount +
        orphanedApplicationsResult.deletedCount;

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
}

