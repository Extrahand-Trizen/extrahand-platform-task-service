import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { AuthenticatedRequest } from '../types';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { emitBookNowLeadRemoved } from '../socket/socketHandlers';
import logger from '../config/logger';
import { CatalogService } from '../services/CatalogService';
import { resolvePartnerMatchConditions, normalizeCategory } from '../services/partnerVisibility';
import { CancellationPassService } from '../services/CancellationPassService';
import { serializeBookNowLeadExecutionFields } from '../utils/bookNowLeadSerialization';

/**
 * Server-side visibility guard for the Book Now partner feed.
 *
 * A Book Now job is only visible to a partner when BOTH match:
 *   - Category match: the job's service category equals one of the partner's
 *     registered/approved service categories (partnerProfile.categories).
 *   - Work area match: the job's locality (location.taskArea / locality /
 *     city mentioned in the address) equals one of the partner's selected
 *     work areas (partnerProfile.workAreas).
 *
 * The restriction is applied inside the Mongo query itself, so a partner can
 * never receive a job they don't qualify for — even via direct API calls.
 */

export class PartnerBookNowController {
  /**
   * GET /api/v1/book-now/available-leads
   * Fetch open (unassigned) Book Now tasks for the authenticated partner.
   * A job is only visible when BOTH match:
   *   - Category match: the job's service category equals one of the
   *     partner's registered/approved service categories
   *     (partnerProfile.categories).
   *   - Work area match: the job's locality (location.taskArea / locality /
   *     city mentioned in the address) equals one of the partner's selected
   *     work areas (partnerProfile.workAreas).
   * "Overdue" tasks are still status === 'open' in the DB — they show up too.
   *
   * Query params:
   *   - categories (comma-separated, optional) – additional narrowing on top
   *     of the partner's own categories
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
      assigneeId: null,
      assigneeUid: null,
    };

    // Server-side visibility guard: the requesting partner can only ever see
    // jobs whose category matches one of their registered categories AND whose
    // locality matches one of their selected work areas.
    const partnerMatch = await resolvePartnerMatchConditions(req);
    if (!partnerMatch) {
      // Partner not found, or has no categories / no work areas → no leads.
      ApiResponse.success(res, [], 'Available leads retrieved');
      return;
    }

    const andConditions: Record<string, any>[] = [partnerMatch.category, partnerMatch.workArea];

    // Optional client-provided `categories` param further narrows the feed;
    // it can never widen it past the partner's own category constraints.
    if (categories) {
      const explicitAreas = categories
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (explicitAreas.length) {
        const normalizedAreas = explicitAreas.map(normalizeCategory);
        andConditions.push({
          $or: [
            { category: { $in: normalizedAreas } },
            { categorySlug: { $in: normalizedAreas } },
            { categoryLabel: { $in: explicitAreas } },
          ],
        });
      }
    }

    if (andConditions.length) filter.$and = andConditions;

    let tasks: Record<string, any>[];

    if (userLat !== undefined && userLng !== undefined) {
      // $geoNear must be the FIRST stage of the pipeline; the visibility
      // filter (bookingSource/status/category/work-area guard) is passed
      // through its `query` option.
      tasks = await Task.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [userLng, userLat] },
            distanceField: 'distance',
            maxDistance: maxRadius * 1000,
            spherical: true,
            query: filter,
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

        let serviceContent: { includes?: string[]; excludes?: string[] } | null = null;
        try {
          serviceContent = await CatalogService.resolveSkuContent({
            categorySlug: String(task.categorySlug || task.category || ''),
            taskTitle: typeof task.title === 'string' ? task.title : undefined,
          });
        } catch {
          serviceContent = null;
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
          serviceIncludes: serviceContent?.includes || [],
          serviceNotIncludes: serviceContent?.excludes || [],
          isOverdue,
          ...serializeBookNowLeadExecutionFields(task),
        };
      }),
    );

    // Logger: Print partner Name, Profile ID, UID, Work Areas, Categories & calculated distance for all returned Book Now leads
    const partnerUid = req.user?.uid || (req.headers['x-user-id'] as string) || 'unknown';
    let partnerName = 'Partner';
    let partnerProfileId = req.user?.profileId?.toString() || 'N/A';
    let partnerWorkAreas: string[] = [];
    let partnerCategories: string[] = [];
    let partnerLat: number | undefined = userLat;
    let partnerLng: number | undefined = userLng;

    try {
      const Profile = mongoose.connection.collection('profiles');
      const pDoc = await Profile.findOne(
        { $or: [{ uid: partnerUid }, { _id: req.user?.profileId }] },
        { projection: { name: 1, fullName: 1, _id: 1, partnerProfile: 1, location: 1, homeLocation: 1 } }
      );
      if (pDoc) {
        partnerName = (pDoc as any).name || (pDoc as any).fullName || 'Partner';
        partnerProfileId = String((pDoc as any)._id);
        const pp = (pDoc as any).partnerProfile || {};
        partnerWorkAreas = Array.isArray(pp.workAreas) ? pp.workAreas : [];
        partnerCategories = Array.isArray(pp.categories) ? pp.categories : [];

        if (partnerLat === undefined || partnerLng === undefined) {
          const pCoords = (pDoc as any).location?.coordinates || (pDoc as any).homeLocation?.coordinates;
          if (Array.isArray(pCoords) && pCoords.length === 2 && typeof pCoords[1] === 'number') {
            partnerLng = pCoords[0];
            partnerLat = pCoords[1];
          }
        }
      }
    } catch {
      // swallow — profile lookup for logging is best-effort
    }

    logger.info(`📋 [BookNowLeads] Partner Name: "${partnerName}" | Profile ID: ${partnerProfileId} | UID: ${partnerUid}`);
    logger.info(`   Partner Work Areas: [${partnerWorkAreas.join(', ')}] | Categories: [${partnerCategories.join(', ')}] | Total Available Leads: ${enriched.length}`);

    enriched.forEach((lead, idx) => {
      const rank = idx + 1;
      let distKm: number | null = lead.distance != null ? lead.distance / 1000 : null;

      // Fallback Haversine distance calculation if geoNear distance was not computed by query
      if (distKm === null && partnerLat !== undefined && partnerLng !== undefined && lead.location?.coordinates) {
        const coords = lead.location.coordinates;
        if (Array.isArray(coords) && coords.length === 2 && typeof coords[1] === 'number') {
          const dLat = (coords[1] - partnerLat) * (Math.PI / 180);
          const dLon = (coords[0] - partnerLng) * (Math.PI / 180);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(partnerLat * (Math.PI / 180)) * Math.cos(coords[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
          distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
      }

      const distStr = distKm !== null ? `${distKm.toFixed(2)} km` : 'Location Coordinates Not Set';
      const workAreaStr =
        lead.location?.taskArea ||
        lead.location?.locality ||
        lead.location?.city ||
        lead.location?.address ||
        'N/A';

      logger.info(
        `   Rank #${rank} | Task ID: ${lead.id} | Title: "${lead.title}" | Category: ${lead.categoryLabel || lead.category} | Work Area: "${workAreaStr}" | Distance: ${distStr}`
      );
    });

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
        assigneeId: null,
        assigneeUid: null,
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
      $or: [{ partnerId: partnerOid }, { assigneeId: partnerOid }],
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
        let serviceContent: { includes?: string[]; excludes?: string[] } | null = null;
        try {
          serviceContent = await CatalogService.resolveSkuContent({
            categorySlug: String(task.categorySlug || task.category || ''),
            taskTitle: typeof task.title === 'string' ? task.title : undefined,
          });
        } catch {
          serviceContent = null;
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
          confirmed: Boolean(task.confirmed),
          confirmedAt: task.confirmedAt || (task as any).confirmed_at || null,
          confirmed_at: task.confirmedAt || (task as any).confirmed_at || null,
          requesterName,
          bookingOrderId: task.bookingOrderId,
          bookingItemId: task.bookingItemId,
          serviceIncludes: serviceContent?.includes || [],
          serviceNotIncludes: serviceContent?.excludes || [],
          ...serializeBookNowLeadExecutionFields(task),
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
    const { status: newStatus, cancellationReason } = req.body as {
      status?: string;
      cancellationReason?: string;
    };

    const ALLOWED_STATUSES = ['started', 'in_progress', 'review', 'completed', 'cancelled'];
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

    // Partner-initiated cancellation — only allowed before the journey starts
    // (task still in 'assigned'). The customer's payment stays untouched; the
    // partner is unassigned and the task returns to the pool for anyone to accept.
    if (newStatus === 'cancelled') {
      const task = await Task.findOne({
        _id: new mongoose.Types.ObjectId(String(id)),
        bookingSource: 'book_now',
        partnerId: partnerOid,
        status: 'assigned',
      }).lean();

      if (!task) {
        throw new BadRequestError('Task can only be cancelled before the journey is started');
      }

      // Track cancellation pass usage (best-effort, non-blocking).
      // No penalty is applied — passes are informational only.
      try {
        await CancellationPassService.consumePass(uid);
      } catch (passError: any) {
        logger.error('[PartnerBookNow] Cancellation pass tracking failed:', {
          taskId: id,
          error: passError?.message || passError,
        });
      }

      const reopened = await Task.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(String(id)),
          bookingSource: 'book_now',
          partnerId: partnerOid,
          status: 'assigned',
        },
        {
          $set: {
            status: 'open',
            partnerId: null,
            partnerUid: null,
            assigneeId: null,
            assigneeUid: null,
            partnerAcceptedAt: null,
            assignedAt: null,
            cancelledAt: new Date(),
            cancelledById: partnerOid,
            cancellationReason: cancellationReason || null,
            updatedAt: new Date(),
          },
        },
        { new: true },
      );

      if (!reopened) {
        throw new NotFoundError('Task not found or you are not the assigned partner');
      }

      console.log(`[PartnerBookNow] updateLeadStatus: task=${id} uid=${uid} CANCELLED → returned to pool`);
      ApiResponse.success(
        res,
        { id: String(reopened._id), status: 'open', cancelled: true },
        'Job cancelled and returned to the pool',
      );
      return;
    }

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

  /**
   * POST /api/v1/book-now/tasks/:id/confirm-assignment
   * Partner acknowledges/confirms their assigned Book Now lead.
   * Sets task.confirmed = true and task.confirmedAt = current timestamp.
   */
  static async confirmAssignment(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
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

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new BadRequestError('Invalid task ID');
    }

    const partnerOid =
      profileId instanceof mongoose.Types.ObjectId
        ? profileId
        : new mongoose.Types.ObjectId(profileId as string);

    const task = await Task.findOne({
      _id: new mongoose.Types.ObjectId(id),
      bookingSource: 'book_now',
      $or: [{ partnerId: partnerOid }, { partnerUid: uid }],
    });

    if (!task) {
      throw new NotFoundError('Assigned Book Now lead not found or not assigned to partner');
    }

    const now = new Date();
    task.confirmed = true;
    task.confirmedAt = now;
    (task as any).confirmed_at = now;
    await task.save();

    logger.info(`[PartnerBookNow] Task ${id} assignment confirmed by partner ${uid} at ${now.toISOString()}`);

    ApiResponse.success(
      res,
      {
        id: String(task._id),
        confirmed: true,
        confirmedAt: now,
        confirmed_at: now,
      },
      'Assignment confirmed successfully',
    );
  }

  /**
   * GET /api/v1/book-now/admin/unacknowledged-leads
   * Returns assigned Book Now leads where partner has NOT yet confirmed (confirmed !== true).
   * Flagged for support team dashboard follow-up.
   */
  static async getUnacknowledgedLeads(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const tasks = await Task.find({
      bookingSource: 'book_now',
      status: 'assigned',
      $or: [{ confirmed: { $ne: true } }, { confirmed: false }],
    })
      .sort({ assignedAt: -1, createdAt: -1 })
      .lean();

    ApiResponse.success(res, tasks, 'Unacknowledged leads retrieved for support dashboard');
  }

  /**
   * GET /api/v1/book-now/cancellation-pass-status
   * Returns the partner's current month cancellation pass status.
   * Passes are informational only — cancellation is always allowed.
   */
  static async getCancellationPassStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);

    if (!uid) {
      throw new BadRequestError('UID required');
    }

    const passStatus = await CancellationPassService.getPassStatus(uid);

    ApiResponse.success(res, passStatus, 'Cancellation pass status retrieved');
  }
}
