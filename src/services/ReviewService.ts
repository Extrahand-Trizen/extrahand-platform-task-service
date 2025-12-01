import Review, { IReview } from '../models/Review';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { ReviewRatings } from '../types';
import mongoose from 'mongoose';

export class ReviewService {
  /**
   * Create a review
   */
  static async createReview(
    taskId: string,
    reviewerUid: string,
    reviewData: {
      rating: number;
      title?: string;
      comment?: string;
      ratings?: ReviewRatings;
    }
  ): Promise<IReview> {
    const { rating, title, comment, ratings } = reviewData;

    if (rating < 1 || rating > 5) {
      throw new BadRequestError('Rating must be between 1 and 5');
    }

    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Allow review creation for tasks in 'review' or 'completed' status
    if (task.status !== 'review' && task.status !== 'completed') {
      throw new BadRequestError('Can only review tasks that are in review or completed status');
    }

    // Check if user is the task requester (poster)
    if (task.requesterId !== reviewerUid) {
      throw new ForbiddenError('Only task requesters can review tasks');
    }

    // Get the performer's UID
    let performerUid = task.assigneeUid;

    // If no direct assigneeUid, check for accepted applications
    if (!performerUid) {
      const acceptedApplication = await TaskApplication.findOne({
        taskId: taskId,
        status: 'accepted',
      });

      if (acceptedApplication) {
        performerUid = acceptedApplication.applicantUid;
      }
    }

    if (!performerUid) {
      throw new BadRequestError('Task has no assigned performer');
    }

    // Check if review already exists
    const existingReview = await Review.findOne({
      taskId: taskId,
      reviewerUid: reviewerUid,
    });

    if (existingReview) {
      throw new BadRequestError('You have already reviewed this task');
    }

    // Create review
    const review = await Review.create({
      taskId: taskId,
      reviewerUid: reviewerUid,
      reviewedUid: performerUid,
      rating: rating,
      title: title || '',
      comment: comment || '',
      ratings: {
        communication: ratings?.communication || rating,
        quality: ratings?.quality || rating,
        timeliness: ratings?.timeliness || rating,
        professionalism: ratings?.professionalism || rating,
        value: ratings?.value || rating,
      },
    });

    // Update task with review and complete it
    await Task.findByIdAndUpdate(taskId, {
      status: 'completed',
      assigneeUid: performerUid, // Ensure assigneeUid is set
      rating: rating,
      review: comment || '',
      completedAt: new Date(),
      updatedAt: new Date()
    });

    // Update performer's profile rating
    try {
      const Profile = mongoose.connection.collection('profiles');
      const avgRatingResult = await Review.aggregate([
        { $match: { reviewedUid: performerUid } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            count: { $sum: 1 }
          }
        }
      ]);

      if (avgRatingResult.length > 0) {
        const { avgRating, count } = avgRatingResult[0];
        await Profile.updateOne(
          { uid: performerUid },
          { 
            $set: { 
              rating: Math.round(avgRating * 10) / 10, // Round to 1 decimal place
              totalReviews: count,
              updatedAt: new Date()
            }
          }
        );
      }
    } catch (error) {
      logger.warn('Could not update performer rating:', error);
    }

    logger.info(`✅ Review created successfully: ${review._id} for task ${taskId}`);
    return review;
  }

  /**
   * Get review for a specific task
   */
  static async getTaskReview(taskId: string, uid: string): Promise<IReview | null> {
    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is involved in the task
    if (task.requesterId !== uid && task.assigneeUid !== uid) {
      throw new ForbiddenError('Not authorized to view this review');
    }

    // Find review for this task with populated profiles
    const review = await Review.findOne({ taskId: taskId })
      .lean();

    // Note: populate doesn't work with UID strings, so we'd need to manually fetch profiles
    // For now, return as-is (original backend also had this limitation)
    return review;
  }

  /**
   * Get reviews for a specific user
   */
  static async getUserReviews(
    userId: string,
    filters: {
      limit?: number;
      skip?: number;
      rating?: number | null;
    }
  ): Promise<{ reviews: IReview[] }> {
    const { limit = 20, skip = 0, rating } = filters;

    // Use static method if available, otherwise use direct query
    let reviews;
    if ((Review as any).getUserReviews) {
      reviews = await (Review as any).getUserReviews(userId, {
        limit,
        skip,
        rating: rating || null
      }).lean();
    } else {
      const query: any = { reviewedUid: userId, isPublic: true };
      if (rating !== null && rating !== undefined) {
        query.rating = rating;
      }

      reviews = await Review.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    }

    // Old format: just return reviews array
    return { reviews };
  }
}

