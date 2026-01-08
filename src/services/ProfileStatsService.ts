import Task from '../models/Task.js';
import Review from '../models/Review.js';
import mongoose from 'mongoose';
import axios from 'axios';

/**
 * Profile Statistics Service
 * Runs in TASK SERVICE where Task and Review models exist
 * Calculates stats and updates user-service via HTTP
 */

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3002';
const SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET || 'your-service-secret';

interface ProfileStats {
  totalTasks: number;
  completedTasks: number;
  postedTasks: number;
  rating: number;
  totalReviews: number;
}

export class ProfileStatsService {
  /**
   * Calculate statistics using Task and Review aggregations
   */
  static async calculateProfileStats(profileId: mongoose.Types.ObjectId | string): Promise<ProfileStats> {
    const objectId = typeof profileId === 'string' ? new mongoose.Types.ObjectId(profileId) : profileId;

    // Tasks as assignee (tasker)
    const taskerStats = await Task.aggregate([
      { $match: { assigneeId: objectId } },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          completedTasks: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        },
      },
    ]);

    // Tasks as requester (poster)
    const posterStats = await Task.aggregate([
      { $match: { requesterId: objectId } },
      { $group: { _id: null, postedTasks: { $sum: 1 } } },
    ]);

    // Review statistics
    const reviewStats = await Review.aggregate([
      { $match: { reviewedId: objectId, isPublic: true } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          avgRating: { $avg: '$rating' },
        },
      },
    ]);

    return {
      totalTasks: taskerStats[0]?.totalTasks || 0,
      completedTasks: taskerStats[0]?.completedTasks || 0,
      postedTasks: posterStats[0]?.postedTasks || 0,
      totalReviews: reviewStats[0]?.totalReviews || 0,
      rating: reviewStats[0]?.avgRating || 0,
    };
  }

  /**
   * Calculate and update profile stats in user-service
   */
  static async updateProfileStats(profileId: mongoose.Types.ObjectId | string): Promise<void> {
    const stats = await this.calculateProfileStats(profileId);

    await axios.patch(
      `${USER_SERVICE_URL}/api/v1/profiles/${profileId}/internal/stats`,
      {
        totalTasks: stats.totalTasks,
        completedTasks: stats.completedTasks,
        postedTasks: stats.postedTasks,
        totalReviews: stats.totalReviews,
        rating: Number(stats.rating.toFixed(1)),
      },
      {
        headers: {
          'x-service-auth': SERVICE_AUTH_SECRET,
          'x-service-name': 'task-service',
        },
      }
    );

    console.log(`✅ Updated profile stats for ${profileId}`);
  }
}

export default ProfileStatsService;
