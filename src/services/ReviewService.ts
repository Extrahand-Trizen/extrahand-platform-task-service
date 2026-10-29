import Review, { IReview } from '../models/Review';
import Task from '../models/Task';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { ReviewRatings } from '../types';
import mongoose from 'mongoose';

function extractProfileDisplayName(profile: any): string | null {
  if (!profile || typeof profile !== 'object') return null;

  const direct =
    (typeof profile.name === 'string' && profile.name.trim()) ||
    (typeof profile.fullName === 'string' && profile.fullName.trim()) ||
    (typeof profile.displayName === 'string' && profile.displayName.trim()) ||
    '';
  if (direct) return direct;

  const first = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
  const last = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
  const combined = `${first} ${last}`.trim();
  return combined || null;
}


const STATIC_TO_BACKEND_PACKAGE_ALIASES: Record<string, readonly string[]> = {
  'ac-installation': ['split-ac-installation', 'window-ac-installation', 'ac-install', 'ac-installation-split-ac', 'ac-installation-window-ac'],
  'ac-uninstallation': ['split-ac-uninstallation', 'window-ac-uninstallation', 'ac-uninstall', 'ac-uninstallation-split-ac', 'ac-uninstallation-window-ac'],
  'ac-repair': ['ac-diagnosis-inspection', 'ac-repair', 'ac-diagnosis'],
  'foam-jet-ac-service': ['foam-blast-service', 'foam-jet-ac-service', 'premium-ac-service', 'anti-rust-service'],
  'ac-gas-refill-checkup': ['r22-gas-refill', 'r32-gas-refill', 'ac-gas-refill-checkup', 'ac-gas-refill-and-check-up'],
  'wm-checkup': ['wm-checkup', 'washing-machine-check-up', 'washing-machine-check-up-fully-automatic-top-load', 'washing-machine-check-up-fully-automatic-front-load', 'washing-machine-check-up-semi-automatic'],
  'wm-installation': ['wm-installation', 'washing-machine-installation', 'washing-machine-installation-fully-automatic-top-load', 'washing-machine-installation-fully-automatic-front-load', 'washing-machine-installation-semi-automatic'],
  'wm-uninstallation': ['wm-uninstallation', 'washing-machine-uninstallation', 'washing-machine-uninstallation-fully-automatic-top-load', 'washing-machine-uninstallation-fully-automatic-front-load', 'washing-machine-uninstallation-semi-automatic'],
  'fridge-checkup': ['fridge-checkup', 'refrigerator-check-up', 'refrigerator-check-up-single-door', 'refrigerator-check-up-double-door', 'refrigerator-check-up-side-by-side'],
  'geyser-servicing': ['geyser-servicing', 'geyser-service', 'geyser-service-up-to-10l', 'geyser-service-10l-to-25l', 'geyser-service-above-25l'],
  'sofa-cleaning': ['sofa-cleaning', '2-seater-dry-foam', '3-seater-dry-foam', 'l-shape-dry-foam', 'sofa-chair-clean', 'sofa-cushion-cleaning'],
  'kitchen-cleaning': ['standard-kitchen-clean', 'deep-kitchen-clean', 'empty-kitchen-clean', 'post-reno-kitchen-clean', 'kitchen-cabinet-cleaning', 'kitchen-window-cleaning'],
  'bathroom-cleaning': ['regular-clean', 'deep-clean', 'bathroom-regular', 'bathroom-deep', 'Bathroom Cleaning – Machine Cleaning', 'Bathroom Cleaning – Hands On Cleaning'],
  'full-house': ['1bhk-economy', '2bhk-economy', '3bhk-economy', '4bhk-economy', 'Full House Cleaning – Furnished Apartment', 'Full House Cleaning – Unfurnished Apartment'],
  'hourly-helper': ['hourly-30m', 'hourly-1h', 'hourly-2h', 'hourly-3h', 'hourly-4h'],
};

function getCategoryMatchSlugs(input?: string): string[] {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return [];
  if (['bathroom', 'bathroom-cleaning'].includes(s)) {
    return ['bathroom', 'bathroom-cleaning'];
  }
  if (['kitchen', 'kitchen-cleaning'].includes(s)) {
    return ['kitchen', 'kitchen-cleaning'];
  }
  if (['sofa', 'sofa-cleaning', 'upholstery'].includes(s)) {
    return ['sofa', 'sofa-cleaning', 'upholstery'];
  }
  if (['full-house', 'home-cleaning'].includes(s)) {
    return ['full-house', 'home-cleaning'];
  }
  if (['ac-services', 'ac-repair', 'ac-servicing'].includes(s)) {
    return ['ac-services', 'ac-repair', 'ac-servicing'];
  }
  if (['appliance-repair', 'washing-machine', 'refrigerator', 'water-purifier', 'geyser'].includes(s)) {
    return ['appliance-repair', 'washing-machine', 'refrigerator', 'water-purifier', 'geyser'];
  }
  return [s];
}

function resolvePackageAliases(packageId?: string): string[] {
  const id = String(packageId || '').trim().toLowerCase();
  if (!id) return [];
  const set = new Set<string>([id]);
  for (const [canonical, aliases] of Object.entries(STATIC_TO_BACKEND_PACKAGE_ALIASES)) {
    const canonicalLower = canonical.toLowerCase();
    const aliasesLower = aliases.map((a) => a.toLowerCase());
    if (canonicalLower === id || aliasesLower.includes(id)) {
      set.add(canonicalLower);
      aliasesLower.forEach((a) => set.add(a));
    }
  }
  return Array.from(set);
}

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
    // @ts-ignore
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
      updatedAt: new Date(),
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
            count: { $sum: 1 },
          },
        },
      ]);

      if (avgRatingResult.length > 0) {
        const { avgRating, count } = avgRatingResult[0];
      await Profile.updateOne(
        { _id: performerId },
        {
          $set: {
            rating: Math.round(avgRating * 10) / 10, // Round to 1 decimal place
            totalReviews: count,
            updatedAt: new Date(),
          },
          $inc: {
            completedTasks: 1,
            totalTasks: 1,
          },
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
    // @ts-ignore
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
        Profile.findOne({ _id: review.reviewedId }),
      ]);

      // Attach profile data to review
      const enrichedReview: any = {
        ...review,
        reviewerName: extractProfileDisplayName(reviewerProfile) || 'Anonymous',
        reviewerAvatar: reviewerProfile?.photoURL || reviewerProfile?.avatar || null,
        reviewedName: extractProfileDisplayName(reviewedProfile) || 'User',
        reviewedAvatar: reviewedProfile?.photoURL || reviewedProfile?.avatar || null,
      };

      return enrichedReview as IReview;
    } catch (error) {
      logger.warn('Could not fetch profile data for review:', error);
      // Return review without profile data as fallback
      return review as unknown as IReview;
    }
  }

  /**
   * Vote helpful/not helpful on a review – one vote per user, toggle supported
   */
  static async voteHelpful(
    reviewId: string,
    voterId: string, // profile ObjectId string
    helpful: boolean
  ): Promise<IReview> {
    const review = await Review.findById(reviewId);
    if (!review) {
      throw new NotFoundError('Review not found');
    }

    const voterField = helpful ? 'helpfulVoters' : 'notHelpfulVoters';
    const otherVoterField = helpful ? 'notHelpfulVoters' : 'helpfulVoters';
    const countField = helpful ? 'helpful' : 'notHelpful';
    const otherCountField = helpful ? 'notHelpful' : 'helpful';

    const alreadyVotedThisSide = (review as any)[voterField].includes(voterId);
    const alreadyVotedOtherSide = (review as any)[otherVoterField].includes(voterId);

    if (alreadyVotedThisSide) {
      // Already voted this direction – no-op
      return review;
    }

    const update: any = {
      $addToSet: { [voterField]: voterId },
      $inc: { [countField]: 1 },
    };

    // Remove from opposite side if switching
    if (alreadyVotedOtherSide) {
      update.$pull = { [otherVoterField]: voterId };
      update.$inc[otherCountField] = -1;
    }

    const updated = await Review.findByIdAndUpdate(reviewId, update, { new: true });
    return updated as IReview;
  }

  /**
   * Get aggregated review statistics for a specific user (count + average rating)
   */
  static async getUserReviewStats(userId: string): Promise<{ totalReviews: number; avgRating: number }> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return { totalReviews: 0, avgRating: 0 };
      }

      const objectId = new mongoose.Types.ObjectId(userId);
      const agg = await Review.aggregate([
        { $match: { reviewedId: objectId, isPublic: true } },
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            avgRating: { $avg: '$rating' },
          },
        },
      ]);

      if (!agg || agg.length === 0) return { totalReviews: 0, avgRating: 0 };

      const row = agg[0] as any;
      return {
        totalReviews: Number(row.totalReviews || 0),
        avgRating: Number(row.avgRating || 0),
      };
    } catch (error) {
      logger.warn('Failed to compute user review stats:', error);
      return { totalReviews: 0, avgRating: 0 };
    }
  }

  /**
   * Get reviews for a specific user (userId = profile ObjectId string)
   */
  static async getUserReviews(
    userId: string,
    filters: {
      limit?: number;
      skip?: number;
      rating?: number | null;
    } = {}
  ): Promise<{ reviews: IReview[] }> {
    const MAX_LIMIT = 50;
    const MAX_PAGE = 100;
    const { limit = 20, skip = 0, rating } = filters;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const maxSkip = (MAX_PAGE - 1) * effectiveLimit;
    const effectiveSkip = Math.min(Math.max(0, skip), maxSkip);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return { reviews: [] };
    }

    const query: any = { isPublic: true };
    query.reviewedId = new mongoose.Types.ObjectId(userId);
    if (rating !== null && rating !== undefined) {
      query.rating = rating;
    }

    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(effectiveSkip)
      .limit(effectiveLimit)
      .lean() as unknown as IReview[];

    if (reviews.length === 0) {
      return { reviews: [] };
    }

    try {
      const Profile = mongoose.connection.collection('profiles');
      const reviewerIds = [
        ...new Set(
          reviews
            .map((review) => review.reviewerId?.toString?.())
            .filter((id): id is string => Boolean(id && mongoose.Types.ObjectId.isValid(id))),
        ),
      ];

      const reviewerProfiles = reviewerIds.length
        ? await Profile.find({
            _id: {
              $in: reviewerIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
          }).toArray()
        : [];

      const profileById = new Map(
        reviewerProfiles.map((profile: any) => [profile._id.toString(), profile]),
      );

      const enrichedReviews = reviews.map((review) => {
        const reviewerProfile = profileById.get(review.reviewerId?.toString?.() || '');
        const reviewerName = extractProfileDisplayName(reviewerProfile);

        return {
          ...review,
          reviewerName: reviewerName || undefined,
          reviewerPhoto:
            reviewerProfile?.photoURL ||
            reviewerProfile?.avatar ||
            reviewerProfile?.profileImageUrl ||
            undefined,
          reviewerUid: reviewerProfile?.uid || undefined,
        };
      });

      return { reviews: enrichedReviews as unknown as IReview[] };
    } catch (error) {
      logger.warn('Could not enrich user reviews with reviewer profiles:', error);
      return { reviews: reviews as unknown as IReview[] };
    }
  }

  /**
   * Aggregate review stats for a service category and its packages
   */
  static async getServiceReviewSummary(
    categorySlug?: string,
    catalogId?: string
  ): Promise<{
    category: {
      rating: number;
      reviewCount: number;
      starBreakdown: Record<number, number>;
    };
    packages: Record<string, {
      rating: number;
      reviewCount: number;
      starBreakdown: Record<number, number>;
    }>;
  }> {
    const targetSlug = (categorySlug || catalogId || '').trim().toLowerCase();
    const catSlugs = getCategoryMatchSlugs(targetSlug);

    const taskQuery: any = {};
    if (catSlugs.length > 0) {
      taskQuery.$or = [
        { categorySlug: { $in: catSlugs } },
        { category: { $in: catSlugs } },
        { subcategory: { $in: catSlugs } },
        { title: { $regex: new RegExp(catSlugs.join('|'), 'i') } },
      ];
    }

    const tasks = await Task.find(taskQuery).select('_id title category categorySlug subcategory').lean();
    let taskIds = tasks.map((t) => t._id);
    const taskMap = new Map(tasks.map((t) => [String(t._id), t]));

    try {
      const BookingItemCol = mongoose.connection.collection('bookingitems');
      const bItems = await BookingItemCol.find({
        $or: [
          { 'skuSnapshot.categorySlug': { $in: catSlugs } },
          { taskId: { $in: taskIds } },
        ],
      }).toArray();
      for (const b of bItems) {
        if (b.taskId && !taskMap.has(String(b.taskId))) {
          taskIds.push(b.taskId);
        }
      }
    } catch {
      // non-fatal
    }

    if (taskIds.length === 0) {
      return {
        category: { rating: 0, reviewCount: 0, starBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
        packages: {},
      };
    }

    const reviews = await Review.find({
      taskId: { $in: taskIds },
      isPublic: true,
      reviewType: 'poster_to_performer',
    }).select('taskId rating comment createdAt').lean();

    let catSum = 0;
    const catBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const pkgBuckets: Record<string, { sum: number; count: number; breakdown: Record<number, number> }> = {};

    function addReviewToBucket(key: string, rating: number) {
      const normalizedKey = key.trim().toLowerCase();
      if (!pkgBuckets[normalizedKey]) {
        pkgBuckets[normalizedKey] = { sum: 0, count: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
      }
      pkgBuckets[normalizedKey].sum += rating;
      pkgBuckets[normalizedKey].count += 1;
      const star = Math.min(5, Math.max(1, Math.round(rating)));
      pkgBuckets[normalizedKey].breakdown[star] = (pkgBuckets[normalizedKey].breakdown[star] || 0) + 1;
    }

    for (const r of reviews) {
      catSum += r.rating;
      const star = Math.min(5, Math.max(1, Math.round(r.rating)));
      catBreakdown[star] = (catBreakdown[star] || 0) + 1;

      const t = taskMap.get(String(r.taskId));
      const sub = t?.subcategory || '';
      if (sub) {
        addReviewToBucket(sub, r.rating);
        for (const [canonicalId, aliases] of Object.entries(STATIC_TO_BACKEND_PACKAGE_ALIASES)) {
          if (aliases.some((a) => a.toLowerCase() === sub.toLowerCase() || (t?.title && t.title.toLowerCase().includes(a.toLowerCase())))) {
            if (canonicalId.toLowerCase() !== sub.toLowerCase()) {
              addReviewToBucket(canonicalId, r.rating);
            }
          }
        }
      }
    }

    const packages: Record<string, { rating: number; reviewCount: number; starBreakdown: Record<number, number> }> = {};
    for (const [key, data] of Object.entries(pkgBuckets)) {
      packages[key] = {
        rating: data.count > 0 ? Number((data.sum / data.count).toFixed(2)) : 0,
        reviewCount: data.count,
        starBreakdown: data.breakdown,
      };
    }

    return {
      category: {
        rating: reviews.length > 0 ? Number((catSum / reviews.length).toFixed(2)) : 0,
        reviewCount: reviews.length,
        starBreakdown: catBreakdown,
      },
      packages,
    };
  }

  /**
   * Get detailed customer reviews for a service / package
   */
  static async getServiceReviews(params: {
    categorySlug?: string;
    catalogId?: string;
    packageId?: string;
    rating?: number | null;
    limit?: number;
    skip?: number;
  }): Promise<{
    reviews: Array<{
      _id: string;
      rating: number;
      title?: string;
      comment?: string;
      reviewerName: string;
      reviewerPhoto?: string;
      createdAt: Date;
      serviceName?: string;
      helpfulCount?: number;
    }>;
    total: number;
    avgRating: number;
    starBreakdown: Record<number, number>;
  }> {
    const { categorySlug, catalogId, packageId, rating, limit = 20, skip = 0 } = params;
    const targetSlug = (categorySlug || catalogId || '').trim().toLowerCase();
    const catSlugs = getCategoryMatchSlugs(targetSlug);
    const packageAliases = resolvePackageAliases(packageId);

    const taskQuery: any = {};
    const andClauses: any[] = [];

    if (catSlugs.length > 0) {
      andClauses.push({
        $or: [
          { categorySlug: { $in: catSlugs } },
          { category: { $in: catSlugs } },
          { subcategory: { $in: catSlugs } },
          { title: { $regex: new RegExp(catSlugs.join('|'), 'i') } },
        ],
      });
    }

    if (packageAliases.length > 0) {
      const escapedAliases = packageAliases.map((a) => a.replace(/[-/\^$*+?.()|[\]{}]/g, '\\$&'));
      andClauses.push({
        $or: [
          { subcategory: { $in: packageAliases } },
          { subcategory: { $in: packageAliases.map((a) => new RegExp('^' + a + '$', 'i')) } },
          { title: { $regex: new RegExp(escapedAliases.join('|'), 'i') } },
        ],
      });
    }

    if (andClauses.length > 0) {
      taskQuery.$and = andClauses;
    }

    const tasks = await Task.find(taskQuery).select('_id title category categorySlug subcategory').lean();
    let taskIds = tasks.map((t) => t._id);
    const taskMap = new Map(tasks.map((t) => [String(t._id), t]));

    try {
      const BookingItemCol = mongoose.connection.collection('bookingitems');
      const bItemQuery: any = {};
      if (catSlugs.length > 0) {
        bItemQuery['skuSnapshot.categorySlug'] = { $in: catSlugs };
      }
      if (packageAliases.length > 0) {
        bItemQuery['skuSnapshot.slug'] = { $in: packageAliases };
      }
      if (Object.keys(bItemQuery).length > 0) {
        const bItems = await BookingItemCol.find(bItemQuery).toArray();
        for (const b of bItems) {
          if (b.taskId && !taskMap.has(String(b.taskId))) {
            taskIds.push(b.taskId);
          }
        }
      }
    } catch {
      // non-fatal
    }

    if (taskIds.length === 0) {
      return {
        reviews: [],
        total: 0,
        avgRating: 0,
        starBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    const baseReviewQuery: any = {
      taskId: { $in: taskIds },
      isPublic: true,
      reviewType: 'poster_to_performer',
    };

    const allMatchingReviews = await Review.find(baseReviewQuery).select('rating').lean();
    const totalMatching = allMatchingReviews.length;
    let sum = 0;
    const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of allMatchingReviews) {
      sum += r.rating;
      const star = Math.min(5, Math.max(1, Math.round(r.rating)));
      breakdown[star] = (breakdown[star] || 0) + 1;
    }
    const avgRating = totalMatching > 0 ? Number((sum / totalMatching).toFixed(2)) : 0;

    const filteredReviewQuery: any = { ...baseReviewQuery };
    if (rating !== null && rating !== undefined && !isNaN(Number(rating))) {
      filteredReviewQuery.rating = Number(rating);
    }

    const effectiveLimit = Math.min(Math.max(1, limit), 50);
    const effectiveSkip = Math.max(0, skip);

    const reviews = await Review.find(filteredReviewQuery)
      .sort({ createdAt: -1 })
      .skip(effectiveSkip)
      .limit(effectiveLimit)
      .lean();

    const totalFiltered = await Review.countDocuments(filteredReviewQuery);

    const reviewerIds = [
      ...new Set(
        reviews
          .map((r: any) => r.reviewerId?.toString())
          .filter((id): id is string => Boolean(id && mongoose.Types.ObjectId.isValid(id)))
      ),
    ];

    let profileMap = new Map<string, any>();
    if (reviewerIds.length > 0) {
      try {
        const ProfileCol = mongoose.connection.collection('profiles');
        const profiles = await ProfileCol.find({
          _id: { $in: reviewerIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).toArray();
        profileMap = new Map(profiles.map((p: any) => [p._id.toString(), p]));
      } catch (err) {
        logger.warn('Could not enrich reviewer profiles:', err);
      }
    }

    const enriched = reviews.map((r: any) => {
      const profile = profileMap.get(r.reviewerId?.toString?.() || '');
      const reviewerName = extractProfileDisplayName(profile) || 'Customer';
      const reviewerPhoto = profile?.photoURL || profile?.avatar || profile?.profileImageUrl;
      const t = taskMap.get(String(r.taskId));
      const serviceName = t?.title || t?.subcategory || (targetSlug ? targetSlug : 'Service');

      return {
        _id: String(r._id),
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        reviewerName,
        reviewerPhoto,
        createdAt: r.createdAt,
        serviceName,
        helpfulCount: Array.isArray(r.helpfulVotes) ? r.helpfulVotes.length : (r.helpfulCount || 0),
      };
    });

    return {
      reviews: enriched,
      total: totalFiltered,
      avgRating,
      starBreakdown: breakdown,
    };
  }

}

export default ReviewService;
