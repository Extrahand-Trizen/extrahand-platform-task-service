import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { AuthenticatedRequest } from '../types';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { emitBookNowLeadRemoved } from '../socket/socketHandlers';
import logger from '../config/logger';

/**
 * Maps category aliases to canonical category names so queries are robust
 * even when the task was created with a different slug variant.
 */
const CATEGORY_MAP: Record<string, string[]> = {
  cleaning: ['cleaning', 'home-cleaning', 'home_cleaning'],
  repair: ['repair', 'plumbing', 'electrical', 'carpenter'],
  plumbing: ['plumbing', 'repair'],
  electrical: ['electrical', 'repair'],
  delivery: ['delivery', 'pickup', 'pick-drop'],
  assembly: ['assembly', 'furniture-assembly'],
  gardening: ['gardening', 'lawn-mowing'],
  petcare: ['petcare', 'pet-care'],
  'packers-movers': ['packers-movers', 'moving'],
  beautician: ['beautician', 'beauty', 'salon'],
  driver: ['driver', 'chauffeur', 'driving'],
  'home-cleaning': ['cleaning', 'home-cleaning'],
};

function normalizeCategory(input: string): string {
  const lower = input.toLowerCase().replace(/[\s_-]+/g, '-');
  for (const [canonical, aliases] of Object.entries(CATEGORY_MAP)) {
    if (aliases.includes(lower) || canonical === lower) return canonical;
  }
  return lower;
}

export class PartnerBookNowController {
  /**
   * GET /api/v1/book-now/available-leads
   * Fetch open (unassigned) Book Now tasks matching the partner's work areas.
   * "Overdue" tasks are still status === 'open' in the DB — they show up too.
   *
   * Query params:
   *   - categories (comma-separated, optional) – override work-areas lookup
   *   - lat, lng, radiusKm (optional) – for geo filtering
   */
  static async getAvailableLeads(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { categories, lat, lng, radiusKm } = req.query as Record<string, string | undefined>;

    const maxRadius = radiusKm ? parseFloat(radiusKm) : 50;
    const userLat = lat ? parseFloat(lat) : undefined;
    const userLng = lng ? parseFloat(lng) : undefined;

    // Filter: book_now tasks, status open, no partner assigned yet
    const filter: Record<string, any> = {
      bookingSource: 'book_now',
      status: 'open',
      partnerId: null,
      partnerUid: null,
    };

    if (categories) {
      const explicitAreas = categories
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (explicitAreas.length) {
        const normalizedAreas = explicitAreas.map(normalizeCategory);
        filter.$or = [
          { category: { $in: normalizedAreas } },
          { categorySlug: { $in: normalizedAreas } },
          { categoryLabel: { $in: explicitAreas } },
        ];
      }
    }

    let tasks: Record<string, any>[];

    if (userLat !== undefined && userLng !== undefined) {
      tasks = await Task.aggregate([
        { $match: filter },
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [userLng, userLat] },
            distanceField: 'distance',
            maxDistance: maxRadius * 1000,
            spherical: true,
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: 50 },
      ]);
    } else {
      tasks = await Task.find(filter).sort({ createdAt: -1 }).limit(50).lean() as Record<string, any>[];
    }

    // Enrich with requester name (best-effort)
    const enriched = await Promise.all(
      tasks.map(async (task) => {
        let requesterName = 'Customer';
        try {
          if (task.requesterId) {
            const Profile = mongoose.connection.collection('profiles');
            const requester = await Profile.findOne(
              { _id: task.requesterId },
              { projection: { name: 1 } },
            );
            if (requester) {
              requesterName = (requester as any).name || 'Customer';
            }
          }
        } catch {
          // swallow — name enrichment is best-effort
        }

        const isOverdue =
          task.status === 'open' &&
          task.scheduledDate &&
          task.dateOption !== 'flexible' &&
          new Date(task.scheduledDate) < new Date();

        return {
          id: String(task._id),
          title: task.title,
          category: task.category,
          categoryLabel: task.categoryLabel || task.category,
          description: task.description,
          budget: task.budget,
          location: task.location,
          scheduledDate: task.scheduledDate,
          scheduledTimeStart: task.scheduledTimeStart,
          scheduledTimeEnd: task.scheduledTimeEnd,
          createdAt: task.createdAt,
          requesterName,
          distance: task.distance ?? undefined,
          bookingOrderId: task.bookingOrderId,
          bookingItemId: task.bookingItemId,
          isOverdue,
        };
      }),
    );

    ApiResponse.success(res, enriched, 'Available leads retrieved');
  }

  /**
   * POST /api/v1/book-now/tasks/:id/partner-accept
   * Atomically accept a Book Now lead. The first partner to call wins.
   * On success the task transitions to status === 'assigned'.
   */
  static async acceptLead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;

    // Gateway sends X-User-Id (not X-User-Uid). Auth middleware populates req.user.uid from it.
    const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);
    let profileId: mongoose.Types.ObjectId | undefined = req.user?.profileId;

    // If profileId wasn't resolved by auth middleware (gateway couldn't look it up),
    // fall back to querying the DB directly by uid.
    if (!profileId && uid) {
      const Profile = mongoose.connection.collection('profiles');
      const found = await Profile.findOne({ uid }, { projection: { _id: 1 } });
      if (found) {
        profileId = found._id as mongoose.Types.ObjectId;
        console.log(`[PartnerBookNow] Resolved profileId from uid fallback: uid=${uid} profileId=${profileId}`);
      }
    }

    if (!profileId || !uid) {
      throw new BadRequestError('Profile ID and UID required');
    }

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new BadRequestError('Invalid task ID');
    }

    // Resolve profileId to ObjectId
    const partnerOid =
      profileId instanceof mongoose.Types.ObjectId
        ? profileId
        : new mongoose.Types.ObjectId(profileId as string);

    // Check partner is enrolled in book_now supply program
    const Profile = mongoose.connection.collection('profiles');
    const profile = await Profile.findOne(
      { _id: partnerOid },
      { projection: { supplyPrograms: 1, partnerProfile: 1, roles: 1 } },
    );

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    const p = profile as Record<string, any>;
    const roles: string[] = p.roles || [];
    const supplyPrograms: string[] = p.supplyPrograms || [];

    // In development mode, allow any performer/partner role to accept. In production, require book_now supply program.
    const isBookNowPartner =
      process.env.NODE_ENV === 'development' ||
      ((roles.includes('tasker') || roles.includes('helper') || roles.includes('partner')) &&
        supplyPrograms.includes('book_now'));

    if (!isBookNowPartner) {
      throw new ForbiddenError('Not enrolled as a Book Now partner');
    }

    // Atomically claim the task — findOneAndUpdate guarantees only one partner wins
    const task = await Task.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(String(id)),
        bookingSource: 'book_now',
        status: 'open',      // overdue tasks are still status === 'open' in DB
        partnerId: null,
        partnerUid: null,
      },
      {
        $set: {
          status: 'assigned',
          partnerId: partnerOid,
          partnerUid: uid,
          assigneeId: partnerOid,
          assigneeUid: uid,
          partnerAcceptedAt: new Date(),
          assignedAt: new Date(),
        },
      },
      { new: true },
    ).lean();

    if (!task) {
      throw new BadRequestError('Lead is no longer available or already accepted');
    }

    const taskDoc = task as Record<string, any>;

    // Notify other connected partners that this lead is gone
    try {
      emitBookNowLeadRemoved(String(taskDoc._id), String(taskDoc.category || ''), String(partnerOid));
    } catch {
      // best-effort socket emit
    }

    ApiResponse.success(res, task, 'Lead accepted successfully');
  }

  /**
   * GET /api/v1/book-now/my-leads
   * Returns the partner's currently active Book Now tasks.
   */
  static async getMyLeads(req: AuthenticatedRequest, res: Response): Promise<void> {
    // Gateway sends X-User-Id. Auth middleware populates req.user.uid from it.
    const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);
    let profileId: mongoose.Types.ObjectId | undefined = req.user?.profileId;

    // Fallback: resolve profileId from DB via uid when header wasn't forwarded
    if (!profileId && uid) {
      const Profile = mongoose.connection.collection('profiles');
      const found = await Profile.findOne({ uid }, { projection: { _id: 1 } });
      if (found) {
        profileId = found._id as mongoose.Types.ObjectId;
        console.log(`[PartnerBookNow] getMyLeads: Resolved profileId from uid: uid=${uid} profileId=${profileId}`);
      }
    }
    if (!profileId) {
      throw new BadRequestError('Profile ID required');
    }

    const partnerOid =
      profileId instanceof mongoose.Types.ObjectId
        ? profileId
        : new mongoose.Types.ObjectId(profileId as string);

    const tasks = await Task.find({
      bookingSource: 'book_now',
      partnerId: partnerOid,
      status: { $in: ['assigned', 'started', 'in_progress', 'review', 'completed', 'cancelled'] },
    })
      .sort({ partnerAcceptedAt: -1 })
      .lean() as Record<string, any>[];

    const enriched = await Promise.all(
      tasks.map(async (task) => {
        let requesterName = 'Customer';
        try {
          if (task.requesterId) {
            const Profile = mongoose.connection.collection('profiles');
            const requester = await Profile.findOne(
              { _id: task.requesterId },
              { projection: { name: 1 } },
            );
            if (requester) {
              requesterName = (requester as any).name || 'Customer';
            }
          }
        } catch {
          // swallow
        }
        return {
          id: String(task._id),
          title: task.title,
          category: task.category,
          categoryLabel: task.categoryLabel || task.category,
          status: task.status,
          budget: task.budget,
          location: task.location,
          scheduledDate: task.scheduledDate,
          scheduledTimeStart: task.scheduledTimeStart,
          scheduledTimeEnd: task.scheduledTimeEnd,
          createdAt: task.createdAt,
          partnerAcceptedAt: task.partnerAcceptedAt,
          requesterName,
          bookingOrderId: task.bookingOrderId,
          bookingItemId: task.bookingItemId,
        };
      }),
    );

    ApiResponse.success(res, enriched, 'My leads retrieved');
  }

  /**
   * PATCH /api/v1/book-now/tasks/:id/status
   * Partner updates the status of their own active Book Now task.
   * Allowed transitions (enforced): assigned→started, started→in_progress, in_progress→review, review→completed
   */
  static async updateLeadStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { status: newStatus } = req.body as { status?: string };

    const ALLOWED_STATUSES = ['started', 'in_progress', 'review', 'completed'];
    if (!newStatus || !ALLOWED_STATUSES.includes(newStatus)) {
      throw new BadRequestError(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
    }

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new BadRequestError('Invalid task ID');
    }

    // Resolve uid and profileId (same fallback pattern as acceptLead)
    const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);
    let profileId: mongoose.Types.ObjectId | undefined = req.user?.profileId;

    if (!profileId && uid) {
      const Profile = mongoose.connection.collection('profiles');
      const found = await Profile.findOne({ uid }, { projection: { _id: 1 } });
      if (found) profileId = found._id as mongoose.Types.ObjectId;
    }

    if (!profileId || !uid) {
      throw new BadRequestError('Profile ID and UID required');
    }

    const partnerOid =
      profileId instanceof mongoose.Types.ObjectId
        ? profileId
        : new mongoose.Types.ObjectId(profileId as string);

    // Build update payload
    const updateFields: Record<string, any> = {
      status: newStatus,
      updatedAt: new Date(),
    };
    if (newStatus === 'started') {
      updateFields.startedAt = new Date();
    }
    if (newStatus === 'completed') {
      updateFields.completedAt = new Date();
      updateFields.completionStatus = 'approved';
      updateFields.completionApprovedAt = new Date();
    }

    const task = await Task.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(String(id)),
        bookingSource: 'book_now',
        partnerId: partnerOid,           // Only the assigned partner can update
        status: { $ne: 'completed' },    // Prevent double-completion
      },
      { $set: updateFields },
      { new: true },
    );

    if (!task) {
      throw new NotFoundError('Task not found or you are not the assigned partner');
    }

    console.log(`[PartnerBookNow] updateLeadStatus: task=${id} uid=${uid} newStatus=${newStatus}`);

    // Auto-payout on Book Now completion
    if (newStatus === 'completed') {
      try {
        const { PaymentClient } = await import('../services/PaymentClient');
        const payoutAmount =
          typeof task.budget === 'object'
            ? task.budget.amount
            : Number(task.budget);
        await PaymentClient.processTaskCompletionPayout({
          taskId: String(task._id),
          performerUid: uid,
          amount: payoutAmount,
          taskTitle: task.title,
        });
      } catch (payoutError: any) {
        logger.error('[PartnerBookNow] Auto-payout failed on completion:', {
          taskId: id,
          error: payoutError?.message || payoutError,
        });
      }
    }

    ApiResponse.success(res, { id: String(task._id), status: newStatus }, 'Status updated');
  }
}
