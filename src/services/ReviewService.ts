import Review, { IReview } from '../models/Review';
import Task from '../models/Task';
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
    reviewerId: mongoose.Types.ObjectId,
    _reviewerUid: string,
    reviewData: {
      rating: number;
      title?: string;
      comment?: string;
      ratings?: ReviewRatings;
      performerUid: string;
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
    if (!task.requesterId.equals(reviewerId)) {
      throw new ForbiddenError('Only task requesters can review tasks');
    }

    // Get the performer's ID from task
    //@ts-ignore
    const performerId = task.assigneeId;

    // If no assignee, can't review
    if (!performerId) {
      throw new BadRequestError('Task has no assigned performer');
    }

    // Check if review already exists
    const existingReview = await Review.findOne({
      taskId: taskId,
      reviewerId: reviewerId,
    });

    if (existingReview) {
      throw new BadRequestError('You have already reviewed this task');
    }

    // Create review using ObjectIds
    const review = await Review.create({
      taskId: taskId,
      reviewerId: reviewerId,
      reviewedId: performerId,
      reviewType: 'poster_to_performer', // Poster reviews the performer/tasker
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
      assigneeId: performerId, // Ensure assigneeId is set
      rating: rating,
      review: comment || '',
      completedAt: new Date(),
      updatedAt: new Date()
    });

    // Update performer's profile rating
    try {
      const Profile = mongoose.connection.collection('profiles');
      const avgRatingResult = await Review.aggregate([
        { $match: { reviewedId: performerId } },
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
          { _id: performerId },
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
  static async getTaskReview(taskId: string, profileId: mongoose.Types.ObjectId, _uid: string): Promise<IReview | null> {
    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is involved in the task (using ObjectId comparison)
    const isRequester = task.requesterId.equals(profileId);
    //@ts-ignore
    const isAssignee = task.assigneeId && task.assigneeId.equals(profileId);
    
    if (!isRequester && !isAssignee) {
      throw new ForbiddenError('Not authorized to view this review');
    }

    // Find review for this task
    const review = await Review.findOne({ taskId: taskId }).lean();
    
    if (!review) {
      return null;
    }

    // Manually fetch reviewer and reviewed user profiles
    try {
      const Profile = mongoose.connection.collection('profiles');
      
      const [reviewerProfile, reviewedProfile] = await Promise.all([
        Profile.findOne({ _id: review.reviewerId }),
        Profile.findOne({ _id: review.reviewedId })
      ]);

      // Attach profile data to review
      const enrichedReview: any = {
        ...review,
        reviewerName: reviewerProfile?.fullName || reviewerProfile?.displayName || 'Anonymous',
        reviewerAvatar: reviewerProfile?.avatar || null,
        reviewedName: reviewedProfile?.fullName || reviewedProfile?.displayName || 'User',
        reviewedAvatar: reviewedProfile?.avatar || null,
      };

      return enrichedReview as IReview;
    } catch (error) {
      logger.warn('Could not fetch profile data for review:', error);
      // Return review without profile data as fallback
      return review as unknown as IReview;
    }
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

    // Build query to find reviews where user is reviewed
    // Support both old format (reviewedUid) and new format (reviewedId)
    const query: any = {
      isPublic: true
    };

    // Check if userId is a valid ObjectId (24 char hex string)
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(userId);
    
    if (isObjectId) {
      // Query by ObjectId for new format + UID for old format
      query.$or = [
        { reviewedUid: userId },
        { reviewedId: new mongoose.Types.ObjectId(userId) }
      ];
    } else {
      // Firebase UID - need to lookup profile ObjectId AND query old UID format
      try {
        const Profile = mongoose.connection.collection('profiles');
        const profile = await Profile.findOne({ uid: userId });
        
        if (profile) {
          // Query by both old format (UID) and new format (ObjectId)
          query.$or = [
            { reviewedUid: userId },
            { reviewedId: profile._id }
          ];
        } else {
          // No profile found, just query by UID (old format only)
          query.reviewedUid = userId;
        }
      } catch (error) {
        logger.warn('Could not lookup profile for UID:', error);
        // Fallback to UID query only
        query.reviewedUid = userId;
      }
    }
    
    if (rating !== null && rating !== undefined) {
      query.rating = rating;
    }

    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Enrich reviews with reviewer profile data
    try {
      const Profile = mongoose.connection.collection('profiles');
      
      // Get unique reviewer IDs (could be ObjectIds or UIDs)
      const reviewerIds = (reviews as any[])
        .map((r: any) => r.reviewerId || r.reviewerUid)
        .filter((id, index, self) => id && self.indexOf(id) === index);

      // Separate ObjectIds from UIDs
      const objectIds: mongoose.Types.ObjectId[] = [];
      const uids: string[] = [];
      
      reviewerIds.forEach(id => {
        if (/^[0-9a-fA-F]{24}$/.test(id.toString())) {
          // Valid ObjectId format
          objectIds.push(new mongoose.Types.ObjectId(id));
        } else {
          // Firebase UID
          uids.push(id.toString());
        }
      });

      // Fetch all reviewer profiles (query by both _id and uid)
      const reviewerProfiles = await Profile.find({
        $or: [
          { _id: { $in: objectIds } },
          { uid: { $in: uids } }
        ]
      }).toArray();

      // Create a map for quick lookup (index by both _id and uid)
      const profileMap = new Map();
      reviewerProfiles.forEach((profile: any) => {
        // Index by ObjectId
        if (profile._id) {
          profileMap.set(profile._id.toString(), profile);
        }
        // Index by UID for old format
        if (profile.uid) {
          profileMap.set(profile.uid, profile);
        }
      });

      // Enrich each review with reviewer data
      const enrichedReviews = reviews.map((review: any) => {
        const reviewerId = review.reviewerId || review.reviewerUid;
        const reviewerProfile = profileMap.get(reviewerId?.toString());

        return {
          ...review,
          reviewerName: reviewerProfile?.name || 'Anonymous',
          reviewerPhoto: reviewerProfile?.photoURL || null,
        };
      });

      return { reviews: enrichedReviews as unknown as IReview[] };
    } catch (error) {
      logger.warn('Could not fetch reviewer profile data:', error);
      // Return reviews without enrichment as fallback
      return { reviews: reviews as unknown as IReview[] };
    }
  }
}

