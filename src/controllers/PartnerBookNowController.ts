import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import Task from '../models/Task';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import logger from '../config/logger';
import { emitBookNowLeadRemoved } from '../socket/socketHandlers';

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
   * Fetch open Book Now tasks matching the partner's work areas.
   * The partner passes their categories (workAreas) so we filter accordingly.
   */
  static async getAvailableLeads(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { categories, lat, lng, radiusKm } = req.query;

    let workAreas: string[] = [];
    if (categories) {
      workAreas = (categories as string).split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
    }

    const profileId = req.user?.profileId || req.headers['x-profile-id'] as string;
    if (!workAreas.length && profileId) {
      try {
        const Profile = mongoose.connection.collection('profiles');
        const profile = await Profile.findOne(
          { _id: new mongoose.Types.ObjectId(profileId) },
          { projection: { partnerProfile: 1, helperWorkAreas: 1 } },
        );
        if (profile) {
          const p = profile as Record<string, unknown>;
          const pp = p.partnerProfile as Record<string, unknown> | undefined;
          workAreas = (pp?.categories as string[]) || (p.helperWorkAreas as string[]) || [];
        }
      } catch (err) {
        logger.warn('Failed to fetch partner work areas from profiles collection', err);
      }
    }

    if (!workAreas.length) {
      ApiResponse.success(res, [], 'No work areas configured');
      return;
    }

    const normalizedAreas = workAreas.map(normalizeCategory);
    const maxRadius = radiusKm ? parseFloat(radiusKm as string) : 50;
    const userLat = lat ? parseFloat(lat as string) : undefined;
    const userLng = lng ? parseFloat(lng as string) : undefined;

    const filter: mongoose.FilterQuery<unknown> = {
      bookingSource: 'book_now',
      status: 'open',
      partnerId: null,
      partnerUid: null,
      $or: [
        { category: { $in: normalizedAreas } },
        { categorySlug: { $in: normalizedAreas } },
        { categoryLabel: { $in: workAreas } },
      ],
    };

    let tasks;
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
      tasks = await Task.find(filter)
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
    }

    const enriched = await Promise.all(
      (tasks as Record<string, unknown>[]).map(async (task) => {
        let requesterName = 'Customer';
        try {
          if (task.requesterId) {
            const Profile = mongoose.connection.collection('profiles');
            const requester = await Profile.findOne(
              { _id: task.requesterId },
              { projection: { name: 1, phone: 1 } },
            );
            if (requester) {
              requesterName = (requester as Record<string, unknown>).name as string || 'Customer';
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
          description: task.description,
          budget: task.budget,
          location: task.location,
          scheduledDate: task.scheduledDate,
          scheduledTimeStart: task.scheduledTimeStart,
          scheduledTimeEnd: task.scheduledTimeEnd,
          createdAt: task.createdAt,
          requesterName,
          distance: task.distance || undefined,
          bookingOrderId: task.bookingOrderId,
          bookingItemId: task.bookingItemId,
        };
      }),
    );

    ApiResponse.success(res, enriched, 'Available leads retrieved');
  }

  /**
   * POST /api/v1/tasks/:id/partner-accept
   * Atomically accept a Book Now lead. Only the first partner to call this succeeds.
   */
  static async acceptLead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const profileId = req.user?.profileId || req.headers['x-profile-id'] as string;
    const uid = req.headers['x-user-uid'] as string || req.user?.uid;
    if (!profileId || !uid) throw new BadRequestError('Profile ID and UID required');

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid task ID');
    }

    const Profile = mongoose.connection.collection('profiles');
    const profile = await Profile.findOne(
      { _id: new mongoose.Types.ObjectId(profileId) },
      { projection: { supplyPrograms: 1, partnerProfile: 1, roles: 1 } },
    );
    if (!profile) throw new NotFoundError('Profile not found');

    const p = profile as Record<string, unknown>;
    const roles = p.roles as string[] || [];
    const supplyPrograms = p.supplyPrograms as string[] || [];
    if (!roles.includes('tasker') || !supplyPrograms.includes('book_now')) {
      throw new ForbiddenError('Not a Book Now partner');
    }

    const task = await Task.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        bookingSource: 'book_now',
        status: 'open',
        partnerId: null,
        partnerUid: null,
      },
      {
        $set: {
          status: 'assigned',
          partnerId: new mongoose.Types.ObjectId(profileId),
          partnerUid: uid,
          assigneeId: new mongoose.Types.ObjectId(profileId),
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

    const taskDoc = task as Record<string, unknown>;
    emitBookNowLeadRemoved(
      String(taskDoc._id),
      String(taskDoc.category || ''),
      String(profileId),
    );

    ApiResponse.success(res, task, 'Lead accepted successfully');
  }

  /**
   * GET /api/v1/book-now/my-leads
   * Get partner's accepted/active Book Now tasks.
   */
  static async getMyLeads(req: AuthenticatedRequest, res: Response): Promise<void> {
    const profileId = req.user?.profileId || req.headers['x-profile-id'] as string;
    if (!profileId) throw new BadRequestError('Profile ID required');

    const tasks = await Task.find({
      bookingSource: 'book_now',
      partnerId: new mongoose.Types.ObjectId(profileId),
      status: { $in: ['assigned', 'started', 'in_progress', 'review'] },
    })
      .sort({ partnerAcceptedAt: -1 })
      .lean();

    const enriched = await Promise.all(
      (tasks as Record<string, unknown>[]).map(async (task) => {
        let requesterName = 'Customer';
        try {
          if (task.requesterId) {
            const Profile = mongoose.connection.collection('profiles');
            const requester = await Profile.findOne(
              { _id: task.requesterId },
              { projection: { name: 1 } },
            );
            if (requester) {
              requesterName = (requester as Record<string, unknown>).name as string || 'Customer';
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
}
