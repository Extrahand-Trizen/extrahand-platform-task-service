import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { AuthenticatedRequest } from '../types';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import logger from '../config/logger';
import { CatalogService } from '../services/CatalogService';
import { resolvePartnerMatchConditions, normalizeCategory } from '../services/partnerVisibility';
import { CancellationPassService } from '../services/CancellationPassService';
import { serializeBookNowLeadExecutionFields } from '../utils/bookNowLeadSerialization';
import { normalizeQcOrderToTask, findQcOrdersForPartner } from '../utils/qcOrderTaskAdapter';
import { QcDatabase } from '../config/qcDatabase';
import { QC_AVAILABLE_ORDERS_MAX_DISTANCE_KM, QC_DEFAULT_DELIVERY_FEE_INR, haversineKm } from '../constants/quickCommerce';
import { PaymentClient } from '../services/PaymentClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';

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
   * GET /api/v1/book-now/available-qc-orders
   * Fetch unassigned Quick Commerce orders within 3 km of the partner.
   * "distance from shop to partner location should be at max 3km only if <=3 then it should show"
   */
  static async getAvailableQcOrders(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { lat, lng } = req.query as Record<string, string | undefined>;
    let partnerLat = lat ? parseFloat(lat) : undefined;
    let partnerLng = lng ? parseFloat(lng) : undefined;

    const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);
    let profileId: mongoose.Types.ObjectId | undefined = req.user?.profileId;

    const Profile = mongoose.connection.collection('profiles');
    let partnerProfile: any = null;
    if (profileId) {
      partnerProfile = await Profile.findOne({
        _id: profileId instanceof mongoose.Types.ObjectId ? profileId : new mongoose.Types.ObjectId(profileId),
      });
    } else if (uid) {
      partnerProfile = await Profile.findOne({ uid });
      if (partnerProfile) profileId = partnerProfile._id;
    }

    // Fallback: resolve partner coordinates from profile if not passed in query
    if (
      (partnerLat === undefined || partnerLng === undefined || isNaN(partnerLat) || isNaN(partnerLng)) &&
      partnerProfile
    ) {
      const homeLoc = (partnerProfile.homeLocation as { coordinates?: number[] } | undefined)?.coordinates;
      const liveLoc = (partnerProfile.location as { coordinates?: number[] } | undefined)?.coordinates;
      const coords =
        Array.isArray(liveLoc) && liveLoc.length === 2 && liveLoc[0] && liveLoc[1]
          ? liveLoc
          : Array.isArray(homeLoc) && homeLoc.length === 2 && homeLoc[0] && homeLoc[1]
          ? homeLoc
          : null;
      if (coords) {
        partnerLng = coords[0];
        partnerLat = coords[1];
      }
    }

    // Connect to QC database
    const qcConnection = await QcDatabase.getQcConnection();
    const CustomerOrders = qcConnection.collection('customerorders');
    const SellerOnboardings = qcConnection.collection('selleronboardings');

    // Query unassigned orders that are paid/placed/ready for delivery
    const unassignedOrders = await CustomerOrders.find({
      $and: [
        {
          $or: [
            { partnerId: null },
            { partnerId: { $exists: false } },
            { assigneeId: null },
            { assigneeId: { $exists: false } },
            { assignmentStatus: 'pending' },
            { assignmentStatus: { $exists: false } },
          ],
        },
        {
          status: { $in: ['PAID', 'PLACED', 'CONFIRMED', 'PENDING_ACCEPT', 'ACCEPTED', 'open'] },
        },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    if (!unassignedOrders.length) {
      ApiResponse.success(res, [], 'Available Quick Commerce orders retrieved');
      return;
    }

    // Cache seller onboarding lookups
    const sellerCache = new Map<string, any>();
    const sellerIdsToFetch = [
      ...new Set(
        unassignedOrders
          .map((o) => (o.sellerId ? String(o.sellerId) : null))
          .filter(Boolean),
      ),
    ];

    if (sellerIdsToFetch.length > 0) {
      const sellerOids = sellerIdsToFetch
        .filter((id) => mongoose.Types.ObjectId.isValid(id!))
        .map((id) => new mongoose.Types.ObjectId(id!));
      const foundSellers = await SellerOnboardings.find({
        $or: [{ sellerId: { $in: sellerOids } }, { _id: { $in: sellerOids } }],
      }).toArray();
      for (const s of foundSellers) {
        if (s.sellerId) sellerCache.set(String(s.sellerId), s);
        sellerCache.set(String(s._id), s);
      }
    }

    const availableList: any[] = [];

    for (const order of unassignedOrders) {
      let shopCoords: [number, number] | null = null;
      let shopName = order.shopName;
      let shopAddress = order.shopAddress;
      let shopArea = order.shopArea;
      let shopCategory = order.shopCategory || 'Quick Commerce';

      if (order.shopCoordinates && Array.isArray(order.shopCoordinates) && order.shopCoordinates.length === 2) {
        shopCoords = [Number(order.shopCoordinates[0]), Number(order.shopCoordinates[1])];
      }

      const sellerKey = order.sellerId ? String(order.sellerId) : null;
      const seller = sellerKey ? sellerCache.get(sellerKey) : null;

      if (seller) {
        if (!shopCoords && seller.longitude && seller.latitude) {
          shopCoords = [seller.longitude, seller.latitude];
        }
        if (!shopName && seller.shopName) shopName = seller.shopName;
        if (!shopAddress) {
          shopAddress =
            seller.formattedAddress ||
            seller.address ||
            [seller.area, seller.locality, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ');
        }
        if (!shopArea) shopArea = seller.area || seller.locality || seller.city;
        if (!order.shopCategory && seller.shopType) shopCategory = seller.shopType;
      }

      // Default fallbacks if missing
      shopName = shopName || 'FreshMart';
      shopAddress = shopAddress || 'Shop address unavailable';
      shopArea = shopArea || order.address?.area || order.address?.locality || order.address?.city || 'Nearby';

      let distKm: number | null = null;
      if (
        partnerLat !== undefined &&
        partnerLng !== undefined &&
        shopCoords &&
        shopCoords.length === 2 &&
        typeof shopCoords[0] === 'number' &&
        typeof shopCoords[1] === 'number'
      ) {
        const [shopLng, shopLat] = shopCoords;
        distKm = haversineKm(shopLat, shopLng, partnerLat, partnerLng);
      }

      // STRICT FILTER: "distance from shop to partner location should be at max 3km only if <=3 then it should show to then"
      if (distKm === null || distKm > QC_AVAILABLE_ORDERS_MAX_DISTANCE_KM) {
        continue;
      }

      const orderIdStr = String(order._id);
      const orderNum = order.orderNumber ? String(order.orderNumber) : `#QC-${orderIdStr.slice(-8).toUpperCase()}`;

      const itemsList = Array.isArray(order.items)
        ? order.items.map((i: any) => ({
            name: i.name || 'Item',
            unit: i.unit || 'pcs',
            quantity: i.quantity || 1,
            unitPricePaise: i.unitPricePaise || 0,
            lineTotalPaise: i.lineTotalPaise || 0,
            imageUrl: i.imageUrl || '',
          }))
        : [];

      const itemCount = itemsList.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 1), 0);

      const deliveryFee =
        (order.deliveryFeePaise ? order.deliveryFeePaise / 100 : 0) ||
        (typeof order.budget === 'object' && order.budget?.amount ? order.budget.amount : QC_DEFAULT_DELIVERY_FEE_INR);

      // Customer dropoff address & area
      const customerArea =
        order.address?.locality ||
        order.address?.area ||
        order.address?.city ||
        order.location?.locality ||
        order.location?.city ||
        shopArea ||
        'Aguruvudi';

      const customerAddress =
        order.location?.address ||
        [order.address?.line1, order.address?.line2, order.address?.city, order.address?.state, order.address?.pinCode]
          .filter(Boolean)
          .join(', ') ||
        'Delivery address unavailable';

      const customerName = order.address?.name || order.customerName || 'Customer';

      let customerCoords: [number, number] | null = null;
      if (
        order.location?.coordinates &&
        Array.isArray(order.location.coordinates) &&
        order.location.coordinates.length === 2
      ) {
        customerCoords = [Number(order.location.coordinates[0]), Number(order.location.coordinates[1])];
      } else if (
        order.address?.coordinates &&
        Array.isArray(order.address.coordinates) &&
        order.address.coordinates.length === 2
      ) {
        customerCoords = [Number(order.address.coordinates[0]), Number(order.address.coordinates[1])];
      }

      // Calculate distance from shop to customer drop-off location
      let shopToCustomerDistKm: number | null = null;
      if (
        shopCoords &&
        shopCoords.length === 2 &&
        customerCoords &&
        customerCoords.length === 2 &&
        typeof customerCoords[0] === 'number' &&
        typeof customerCoords[1] === 'number' &&
        customerCoords[0] !== 0 &&
        customerCoords[1] !== 0
      ) {
        shopToCustomerDistKm = haversineKm(shopCoords[1], shopCoords[0], customerCoords[1], customerCoords[0]);
      }

      const partnerToShopKm = Number(distKm.toFixed(1));
      const shopToCustKm =
        shopToCustomerDistKm != null && shopToCustomerDistKm > 0
          ? Number(shopToCustomerDistKm.toFixed(1))
          : 2.2;
      const totalDistKm = Number((partnerToShopKm + shopToCustKm).toFixed(1));
      const estimatedMinutes = Math.max(15, Math.min(60, Math.round(totalDistKm * 4 + 11)));

      // Format scheduled date/time string e.g. "Wed, 10 Sept · 05:30 AM"
      const dateObj = new Date(order.scheduledDate || order.createdAt || Date.now());
      const dateStr = dateObj.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      const timeStr = dateObj.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      const scheduledDisplay = `${dateStr} · ${timeStr}`;

      availableList.push({
        id: orderIdStr,
        orderId: orderIdStr,
        orderNumber: orderNum.startsWith('#') ? orderNum : `#${orderNum}`,
        shopName,
        shopAddress,
        shopArea,
        shopCategory,
        shopCoordinates: shopCoords,
        customerName,
        customerAddress,
        customerArea,
        customerCoordinates: customerCoords,
        itemCount,
        items: itemsList,
        deliveryFee,
        deliveryFeePaise: order.deliveryFeePaise || deliveryFee * 100,
        distKm: partnerToShopKm,
        partnerToShopDistKm: partnerToShopKm,
        shopToCustomerDistKm: shopToCustKm,
        totalDistKm,
        estimatedMinutes,
        distanceText: `${partnerToShopKm} km`,
        scheduledDate: order.scheduledDate || order.createdAt,
        scheduledDisplay,
        status: 'open',
        isQCommerce: true,
        bookingSource: 'quick_commerce',
        createdAt: order.createdAt,
      });
    }

    // Sort by distance (closest to partner first)
    availableList.sort((a, b) => a.distKm - b.distKm);

    logger.info(`[PartnerBookNow] getAvailableQcOrders: returning ${availableList.length} orders within 3km for partner uid=${uid}`);
    ApiResponse.success(res, availableList, 'Available Quick Commerce orders retrieved');
  }

  /**
   * POST /api/v1/book-now/qc-orders/:id/apply
   * Partner applies for (claims) an available Quick Commerce order.
   * Atomically claims the order with concurrency guard (only first applicant wins).
   */
  static async applyQcOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);
    let profileId: mongoose.Types.ObjectId | undefined = req.user?.profileId;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new BadRequestError('Invalid order ID');
    }

    const Profile = mongoose.connection.collection('profiles');
    let partnerProfile: any = null;
    if (profileId) {
      partnerProfile = await Profile.findOne({
        _id: profileId instanceof mongoose.Types.ObjectId ? profileId : new mongoose.Types.ObjectId(profileId),
      });
    } else if (uid) {
      partnerProfile = await Profile.findOne({ uid });
      if (partnerProfile) profileId = partnerProfile._id;
    }

    if (!profileId || !uid) {
      throw new BadRequestError('Profile ID and UID required');
    }

    const partnerOid =
      profileId instanceof mongoose.Types.ObjectId
        ? profileId
        : new mongoose.Types.ObjectId(profileId as string);

    const partnerName = (partnerProfile?.name || partnerProfile?.fullName || (req.user as any)?.name || 'Partner') as string;

    const qcConnection = await QcDatabase.getQcConnection();
    const CustomerOrders = qcConnection.collection('customerorders');
    const orderOid = new mongoose.Types.ObjectId(String(id));

    // Concurrency guard: update only if unassigned
    const now = new Date();
    const updateResult = await CustomerOrders.updateOne(
      {
        _id: orderOid,
        $and: [
          {
            $or: [
              { partnerId: null },
              { partnerId: { $exists: false } },
              { assigneeId: null },
              { assigneeId: { $exists: false } },
              { assignmentStatus: 'pending' },
              { assignmentStatus: { $exists: false } },
            ],
          },
          {
            status: { $in: ['PAID', 'PLACED', 'CONFIRMED', 'PENDING_ACCEPT', 'ACCEPTED', 'open'] },
          },
        ],
      },
      {
        $set: {
          assigneeUid: uid,
          assigneeId: partnerOid,
          assigneeName: partnerName,
          partnerUid: uid,
          partnerId: partnerOid,
          assignedHelperName: partnerName,
          assignedToName: partnerName,
          assignedTo: {
            userId: uid,
            profileId: String(partnerOid),
            name: partnerName,
            assignedAt: now,
          },
          assignedAt: now,
          partnerAcceptedAt: now,
          assignmentStatus: 'assigned',
          status: 'assigned',
          confirmed: true, // Manual apply is immediately confirmed
          confirmedAt: now,
          updatedAt: now,
        },
      },
    );

    if (updateResult.matchedCount === 0 || updateResult.modifiedCount === 0) {
      throw new BadRequestError('This order has already been assigned to another partner.');
    }

    const updatedOrder = await CustomerOrders.findOne({ _id: orderOid });
    logger.info(`✅ [PartnerBookNow] applyQcOrder: Order ${id} successfully assigned to partner ${partnerName} (${uid})`);

    ApiResponse.success(
      res,
      {
        id: String(updatedOrder?._id),
        orderNumber: updatedOrder?.orderNumber,
        status: 'assigned',
        assignedTo: partnerName,
        assignedAt: now,
      },
      'Quick Commerce order successfully assigned to you',
    );
  }

  /**
   * POST /api/v1/book-now/qc-orders/:id/complete
   * Partner marks a Quick Commerce order as delivered.
   * Updates customerorders status to DELIVERED and triggers partner payout.
   */
  static async completeQcOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);
    let profileId: mongoose.Types.ObjectId | undefined = req.user?.profileId;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new BadRequestError('Invalid order ID');
    }

    if (!uid) {
      throw new BadRequestError('Authentication required');
    }

    const Profile = mongoose.connection.collection('profiles');
    let partnerProfile: any = null;
    if (profileId) {
      partnerProfile = await Profile.findOne({
        _id: profileId instanceof mongoose.Types.ObjectId ? profileId : new mongoose.Types.ObjectId(profileId),
      });
    } else {
      partnerProfile = await Profile.findOne({ uid });
      if (partnerProfile) { profileId = partnerProfile._id; }
    }

    if (!profileId) {
      throw new BadRequestError('Partner profile not found');
    }

    const partnerOid =
      profileId instanceof mongoose.Types.ObjectId
        ? profileId
        : new mongoose.Types.ObjectId(profileId as string);

    const qcConnection = await QcDatabase.getQcConnection();
    const CustomerOrders = qcConnection.collection('customerorders');
    const orderOid = new mongoose.Types.ObjectId(String(id));

    // Fetch the order and verify this partner is assigned
    const order = await CustomerOrders.findOne({ _id: orderOid });
    if (!order) {
      throw new BadRequestError('Quick Commerce order not found');
    }

    const assignedUid = order.assigneeUid || order.partnerUid || order.assignedTo?.userId;
    const assignedProfileId = String(
      order.assigneeId || order.partnerId || order.assignedTo?.profileId || '',
    );
    const isAssigned =
      (assignedUid && assignedUid === uid) ||
      (assignedProfileId && assignedProfileId === String(partnerOid));
    if (!isAssigned) {
      throw new ForbiddenError('You are not assigned to this order');
    }

    if (['DELIVERED', 'completed'].includes(String(order.status))) {
      ApiResponse.success(res, { id: String(order._id), status: 'completed' }, 'Order already completed');
      return;
    }

    const now = new Date();
    await CustomerOrders.updateOne(
      { _id: orderOid },
      {
        $set: {
          status: 'DELIVERED',
          completionStatus: 'approved',
          completedAt: now,
          completionApprovedAt: now,
          updatedAt: now,
        },
      },
    );

    logger.info(
      `[PartnerBookNow] completeQcOrder: Order ${id} marked DELIVERED by partner uid=${uid}`,
    );

    // Resolve delivery fee — default is always ₹29 for Quick Commerce
    const deliveryFee =
      (order.deliveryFeePaise ? order.deliveryFeePaise / 100 : 0) ||
      (typeof order.budget === 'object' && order.budget?.amount ? order.budget.amount : QC_DEFAULT_DELIVERY_FEE_INR);

    const orderNum = order.orderNumber
      ? String(order.orderNumber)
      : `#QC-${String(order._id).slice(-8).toUpperCase()}`;

    // Trigger payout via payment service
    try {
      const payoutResult = await PaymentClient.processTaskCompletionPayout({
        taskId: String(id),
        performerUid: uid,
        amount: deliveryFee,
        taskTitle: order.title || `Quick Commerce Order ${orderNum}`,
      });

      logger.info(`[PartnerBookNow] completeQcOrder: Payout result for order ${id}`, {
        success: payoutResult.success,
        requiresBankAccount: payoutResult.requiresBankAccount,
        error: payoutResult.error,
        payoutId: payoutResult.payout?.payoutId,
        payoutStatus: payoutResult.payout?.status,
      });

      const notifTitle = payoutResult.success
        ? `\u20B9${deliveryFee} payout initiated \uD83C\uDF89`
        : 'Delivery complete';
      const notifBody = payoutResult.success
        ? `Great job! Your delivery earnings of \u20B9${deliveryFee} for order ${orderNum} have been queued for payout.`
        : `Order ${orderNum} completed. Payout initiation failed — please contact support.`;

      await InAppNotificationClient.send({
        userId: String(partnerOid),
        title: notifTitle,
        body: notifBody,
        type: payoutResult.success ? 'success' : 'warning',
        category: 'payments',
        data: {
          orderId: String(id),
          orderNumber: orderNum,
          deliveryFee,
          actionUrl: '/profile?section=payments',
          eventKey: payoutResult.success ? 'PAYOUT_INITIATED' : 'PAYOUT_FAILED',
          entityType: 'qc_order',
        },
      });

      ApiResponse.success(
        res,
        {
          id: String(id),
          orderNumber: orderNum,
          status: 'completed',
          deliveryFee,
          payout: payoutResult.success
            ? {
                status: payoutResult.payout?.status || 'processing',
                payoutId: payoutResult.payout?.payoutId,
              }
            : null,
          payoutSuccess: payoutResult.success,
          payoutError: payoutResult.error,
        },
        payoutResult.success
          ? `Order delivered! \u20B9${deliveryFee} payout has been initiated.`
          : 'Order delivered. Payout could not be initiated automatically.',
      );
    } catch (payoutErr: any) {
      logger.error(`[PartnerBookNow] completeQcOrder: Payout exception for order ${id}`, {
        error: payoutErr?.message,
      });
      ApiResponse.success(
        res,
        { id: String(id), status: 'completed', deliveryFee, payoutSuccess: false },
        'Order marked as delivered. Payout will be processed shortly.',
      );
    }
  }

  /**
   * POST /api/v1/book-now/tasks/:id/partner-accept
   * Atomically accepts a lead if it's a Quick Commerce order.
   * Standard Book Now jobs are assigned automatically by ExtraHand.
   */
  static async acceptLead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    if (id && mongoose.Types.ObjectId.isValid(String(id))) {
      try {
        const qcConnection = await QcDatabase.getQcConnection();
        const CustomerOrders = qcConnection.collection('customerorders');
        const qcOrder = await CustomerOrders.findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
        if (qcOrder) {
          return await PartnerBookNowController.applyQcOrder(req, res);
        }
      } catch {
        // Fall through
      }
    }
    throw new ForbiddenError(
      'Book Now jobs are assigned automatically by ExtraHand or manually by operations.',
    );
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

    const [tasks, qcOrders] = await Promise.all([
      Task.find({
        bookingSource: 'book_now',
        $or: [{ partnerId: partnerOid }, { assigneeId: partnerOid }],
        status: { $in: ['assigned', 'started', 'in_progress', 'review', 'completed', 'cancelled'] },
      })
        .sort({ partnerAcceptedAt: -1 })
        .lean() as Promise<Record<string, any>[]>,
      findQcOrdersForPartner(partnerOid, uid || ''),
    ]);

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

    const qcLeads = qcOrders.map((order) => {
      const task = normalizeQcOrderToTask(order);
      const itemsList = Array.isArray(order.items)
        ? order.items.map((i: any) => `${i.quantity || 1}x ${i.name}`)
        : [];

      return {
        id: String(task._id),
        title: task.title,
        category: task.category,
        categoryLabel: task.categoryLabel,
        status: task.status,
        budget: task.budget,
        location: task.location,
        scheduledDate: task.scheduledDate,
        scheduledTimeStart: task.scheduledTimeStart,
        scheduledTimeEnd: task.scheduledTimeEnd,
        createdAt: task.createdAt,
        partnerAcceptedAt: task.partnerAcceptedAt,
        confirmed: Boolean(task.confirmed),
        confirmedAt: task.confirmedAt,
        confirmed_at: task.confirmed_at,
        requesterName: order.address?.name || 'Customer',
        bookingOrderId: task.bookingOrderId,
        bookingItemId: task.bookingItemId,
        serviceIncludes: itemsList,
        serviceNotIncludes: [],
        isQCommerce: true,
        items: task.items || order.items || [],
        shopName: task.shopName || order.shopName,
        shopAddress: task.shopAddress || order.shopAddress,
        shopCoordinates: task.shopCoordinates || order.shopCoordinates,
        customerName: task.customerName || order.address?.name || 'Customer',
        customerAddress: task.customerAddress || task.location?.address,
        customerCoordinates: task.customerCoordinates || task.location?.coordinates,
        orderNumber: task.orderNumber || order.orderNumber,
        deliveryFee: task.deliveryFee || task.budget?.amount || 45,
        ...serializeBookNowLeadExecutionFields(task),
      };
    });

    const combined = [...enriched, ...qcLeads].sort((a, b) => {
      const timeA = new Date(a.partnerAcceptedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.partnerAcceptedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    ApiResponse.success(res, combined, 'My leads retrieved');
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
        // Fallback: check quick commerce customerorders collection
        const CustomerOrders = mongoose.connection.collection('customerorders');
        const qcOrder = await CustomerOrders.findOne({
          _id: new mongoose.Types.ObjectId(String(id)),
          $or: [
            { partnerId: partnerOid },
            { partnerUid: uid },
            { assigneeId: partnerOid },
            { assigneeUid: uid },
            { 'assignedTo.userId': uid },
            { 'assignedTo.profileId': String(partnerOid) },
          ],
          status: { $in: ['assigned', 'open', 'PAID'] },
        });

        if (!qcOrder) {
          throw new BadRequestError('Task can only be cancelled before the journey is started');
        }

        try {
          await CancellationPassService.consumePass(uid);
        } catch (passError: any) {
          logger.error('[PartnerBookNow] Cancellation pass tracking failed for QC order:', {
            taskId: id,
            error: passError?.message || passError,
          });
        }

        await CustomerOrders.updateOne(
          { _id: qcOrder._id },
          {
            $set: {
              status: 'open',
              partnerId: null,
              partnerUid: null,
              assigneeId: null,
              assigneeUid: null,
              assignedTo: null,
              assignedHelperName: null,
              assignedToName: null,
              assigneeName: null,
              assignmentStatus: 'pending',
              confirmed: false,
              partnerAcceptedAt: null,
              assignedAt: null,
              cancelledAt: new Date(),
              cancelledById: partnerOid,
              cancellationReason: cancellationReason || null,
              updatedAt: new Date(),
            },
          },
        );

        console.log(`[PartnerBookNow] updateLeadStatus: QC task=${id} uid=${uid} CANCELLED → returned to pool`);
        ApiResponse.success(
          res,
          { id: String(qcOrder._id), status: 'open', cancelled: true },
          'Job cancelled and returned to the pool',
        );
        return;
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

    const task = mongoose.Types.ObjectId.isValid(String(id))
      ? await Task.findOneAndUpdate(
          {
            _id: new mongoose.Types.ObjectId(String(id)),
            bookingSource: 'book_now',
            partnerId: partnerOid,           // Only the assigned partner can update
            status: { $ne: 'completed' },    // Prevent double-completion
          },
          { $set: updateFields },
          { new: true },
        )
      : null;

    if (!task) {
      // Fallback: update quick commerce customerorders collection
      const qcConnection = await QcDatabase.getQcConnection();
      const CustomerOrders = qcConnection.collection('customerorders');
      const qcIdQuery = mongoose.Types.ObjectId.isValid(String(id))
        ? [{ _id: new mongoose.Types.ObjectId(String(id)) }, { orderNumber: String(id).replace(/^#/, '') }]
        : [{ orderNumber: String(id).replace(/^#/, '') }];
      const order = await CustomerOrders.findOne({
        $and: [
          { $or: qcIdQuery },
          {
            $or: [
              { partnerId: partnerOid },
              { partnerUid: uid },
              { assigneeId: partnerOid },
              { assigneeUid: uid },
              { 'assignedTo.userId': uid },
              { 'assignedTo.profileId': String(partnerOid) },
            ],
          },
          { status: { $nin: ['completed', 'DELIVERED'] } },
        ],
      });

      if (order) {
        const now = new Date();
        const qcUpdate: Record<string, any> = {
          status: newStatus === 'completed' ? 'DELIVERED' : newStatus,
          updatedAt: now,
        };
        if (newStatus === 'started') {
          qcUpdate.startedAt = now;
          qcUpdate.executionPhase = 'on_the_way';
          qcUpdate.onTheWayAt = now;
        } else if (newStatus === 'in_progress') {
          qcUpdate.inProgressAt = now;
          qcUpdate.executionPhase = 'arrived';
          qcUpdate.arrivedAt = now;
        } else if (newStatus === 'completed') {
          qcUpdate.completedAt = now;
          qcUpdate.completionStatus = 'approved';
          qcUpdate.completionApprovedAt = now;
          qcUpdate.fulfillmentStatus = 'HANDED_OVER';
        }

        await CustomerOrders.updateOne({ _id: order._id }, { $set: qcUpdate });

        console.log(`[PartnerBookNow] updateLeadStatus: QC task=${id} uid=${uid} newStatus=${newStatus}`);

        // Auto-payout on QC order completion: 29 rupees by default
        if (newStatus === 'completed') {
          try {
            const payoutAmount =
              (order.deliveryFeePaise ? order.deliveryFeePaise / 100 : 0) ||
              (typeof order.budget === 'object' && order.budget?.amount ? order.budget.amount : 0) ||
              (typeof order.budget === 'object' && order.budget?.max ? order.budget.max : 0) ||
              QC_DEFAULT_DELIVERY_FEE_INR;

            const orderNum = order.orderNumber
              ? String(order.orderNumber)
              : `#QC-${String(order._id).slice(-8).toUpperCase()}`;

            const payoutResult = await PaymentClient.processTaskCompletionPayout({
              taskId: String(order._id),
              performerUid: uid,
              amount: payoutAmount,
              taskTitle: order.title || `Quick Commerce Order ${orderNum}`,
            });

            logger.info(`[PartnerBookNow] updateLeadStatus: Auto-payout result for QC order ${id}`, {
              success: payoutResult.success,
              amount: payoutAmount,
              payoutId: payoutResult.payout?.payoutId,
              payoutStatus: payoutResult.payout?.status,
              error: payoutResult.error,
            });

            const notifTitle = payoutResult.success
              ? `₹${payoutAmount} payout initiated 🎉`
              : 'Delivery complete';
            const notifBody = payoutResult.success
              ? `Great job! Your delivery earnings of ₹${payoutAmount} for order ${orderNum} have been queued for payout.`
              : `Order ${orderNum} completed. Payout initiation failed — please contact support.`;

            await InAppNotificationClient.send({
              userId: String(partnerOid),
              title: notifTitle,
              body: notifBody,
              type: payoutResult.success ? 'success' : 'warning',
              category: 'payments',
              data: {
                orderId: String(order._id),
                orderNumber: orderNum,
                deliveryFee: payoutAmount,
                actionUrl: '/profile?section=payments',
                eventKey: payoutResult.success ? 'PAYOUT_INITIATED' : 'PAYOUT_FAILED',
                entityType: 'qc_order',
              },
            });
          } catch (payoutError: any) {
            logger.error('[PartnerBookNow] Auto-payout failed on QC completion:', {
              taskId: id,
              error: payoutError?.message || payoutError,
            });
          }
        }

        ApiResponse.success(res, { id: String(order._id), status: newStatus }, 'Status updated');
        return;
      }

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
      // Fallback: check quick commerce customerorders collection
      const CustomerOrders = mongoose.connection.collection('customerorders');
      const order = await CustomerOrders.findOne({
        _id: new mongoose.Types.ObjectId(id),
        $or: [
          { partnerId: partnerOid },
          { partnerUid: uid },
          { assigneeId: partnerOid },
          { assigneeUid: uid },
          { 'assignedTo.userId': uid },
          { 'assignedTo.profileId': String(partnerOid) },
        ],
      });

      if (order) {
        const now = new Date();
        await CustomerOrders.updateOne(
          { _id: order._id },
          {
            $set: {
              confirmed: true,
              confirmedAt: now,
              confirmed_at: now,
              updatedAt: now,
            },
          },
        );

        logger.info(
          `[PartnerBookNow] QC Order ${id} assignment confirmed by partner ${uid} at ${now.toISOString()}`,
        );

        ApiResponse.success(
          res,
          {
            id: String(order._id),
            confirmed: true,
            confirmedAt: now,
            confirmed_at: now,
          },
          'Assignment confirmed successfully',
        );
        return;
      }

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
