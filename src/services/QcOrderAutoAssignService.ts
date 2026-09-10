import mongoose from 'mongoose';
import logger from '../config/logger';
import { QcDatabase } from '../config/qcDatabase';
import { QC_SHOP_PROXIMITY_KM, EARTH_RADIUS_KM } from '../constants/quickCommerce';
import { NotificationClient } from './NotificationClient';

// ─── Haversine Distance ──────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface PartnerCandidate {
  uid: string;
  profileId: string;
  name: string;
  distKm: number | null;
  phone?: string;
}

interface QcOrderShopInfo {
  orderId: string;
  orderNumber: string;
  sellerId?: string;
  shopName?: string;
  shopCoordinates?: [number, number]; // [longitude, latitude]
  shopAddress?: string;
}

interface QcAutoAssignResult {
  assigned: boolean;
  partner?: PartnerCandidate;
  reason?: string;
  shopDistKm?: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class QcOrderAutoAssignService {
  /**
   * Auto-assign a Quick Commerce order to the nearest eligible partner.
   *
   * Criteria:
   * 1. Partner profile status = 'approved'
   * 2. Partner activeForQCommerce = true
   * 3. Partner has 'quick_commerce_delivery' skill/category
   * 4. Distance from partner location to seller shop <= 2.5 km
   *
   * Selects the nearest partner by distance to seller shop.
   */
  static async autoAssign(order: QcOrderShopInfo): Promise<QcAutoAssignResult> {
    const orderId = order.orderId;

    try {
      if (!order.shopCoordinates || order.shopCoordinates.length !== 2) {
        logger.info('[QcOrderAutoAssign] No shop coordinates available, skipping auto-assign', {
          orderId,
          orderNumber: order.orderNumber,
        });
        return { assigned: false, reason: 'No shop coordinates available' };
      }

      const [shopLng, shopLat] = order.shopCoordinates;
      if (typeof shopLng !== 'number' || typeof shopLat !== 'number' || (shopLng === 0 && shopLat === 0)) {
        logger.info('[QcOrderAutoAssign] Invalid shop coordinates, skipping auto-assign', {
          orderId,
          orderNumber: order.orderNumber,
        });
        return { assigned: false, reason: 'Invalid shop coordinates' };
      }

      const Profile = mongoose.connection.collection('profiles');
      const profiles = await Profile.find({
        isActive: true,
        'partnerProfile.status': 'approved',
      }).toArray();

      if (!profiles.length) {
        logger.info('[QcOrderAutoAssign] No active approved partners found', { orderId });
        return { assigned: false, reason: 'No active approved partners' };
      }

      const candidates: PartnerCandidate[] = [];

      for (const p of profiles) {
        const pp = (p.partnerProfile as any) || {};

        // Check active for quick commerce toggle
        const isActiveForQc = pp.activeForQCommerce === true || pp.activeForQCommerceOrders === true;
        if (!isActiveForQc) continue;

        // Check if partner has quick_commerce_delivery skill/category
        const categories: string[] = Array.isArray(pp.categories) ? pp.categories : [];
        const hasQcSkill = categories.some(
          (c) => c === 'quick_commerce_delivery' || c === 'delivery' || c === 'quick_commerce',
        );
        if (!hasQcSkill) continue;

        // Check on-leave status
        if (pp.onLeave === true) continue;

        // Resolve partner location (prefer home, fallback to live)
        const homeLoc = (p.homeLocation as { coordinates?: number[] } | undefined)?.coordinates;
        const liveLoc = (p.location as { coordinates?: number[] } | undefined)?.coordinates;
        const partnerCoords =
          Array.isArray(homeLoc) && homeLoc.length === 2 ? homeLoc :
          Array.isArray(liveLoc) && liveLoc.length === 2 ? liveLoc :
          null;

        if (!partnerCoords) continue;

        const [partnerLng, partnerLat] = partnerCoords;
        if (typeof partnerLng !== 'number' || typeof partnerLat !== 'number' || (partnerLng === 0 && partnerLat === 0)) {
          continue;
        }

        // Calculate distance from partner to seller shop
        const distKm = haversineKm(shopLat, shopLng, partnerLat, partnerLng);

        // Filter: must be within 2.5 km of seller shop
        if (distKm > QC_SHOP_PROXIMITY_KM) continue;

        candidates.push({
          uid: String(p.uid),
          profileId: String(p._id),
          name: (p.name || p.fullName || 'Partner') as string,
          distKm,
          phone: p.phone as string | undefined,
        });
      }

      if (candidates.length === 0) {
        logger.info('[QcOrderAutoAssign] No partner found within shop proximity', {
          orderId,
          orderNumber: order.orderNumber,
          shopName: order.shopName,
          shopLat,
          shopLng,
          searchRadiusKm: QC_SHOP_PROXIMITY_KM,
        });
        return { assigned: false, reason: `No eligible partner within ${QC_SHOP_PROXIMITY_KM} km of shop` };
      }

      // Sort by distance (nearest first) and pick the best
      candidates.sort((a, b) => {
        if (a.distKm === null && b.distKm === null) return 0;
        if (a.distKm === null) return 1;
        if (b.distKm === null) return -1;
        return a.distKm - b.distKm;
      });

      const best = candidates[0];

      // Update order in QC database with assignment
      await QcOrderAutoAssignService.persistOrderAssignment(order, best);

      logger.info(`================================================================================`);
      logger.info(`📢 [QcOrderAutoAssign] QUICK COMMERCE ORDER AUTO-ASSIGNED!`);
      logger.info(`   Order ID         : ${orderId}`);
      logger.info(`   Order Number     : ${order.orderNumber}`);
      logger.info(`   Shop Name        : ${order.shopName || 'N/A'}`);
      logger.info(`   Shop Location    : ${shopLat}, ${shopLng}`);
      logger.info(`--------------------------------------------------------------------------------`);
      logger.info(`✅ PARTNER FOUND AND AUTO-ASSIGNED:`);
      logger.info(`   Partner Name     : ${best.name}`);
      logger.info(`   Partner UID      : ${best.uid}`);
      logger.info(`   Partner Profile  : ${best.profileId}`);
      logger.info(`   Distance to Shop : ${best.distKm?.toFixed(2)} km`);
      logger.info(`   Total Candidates : ${candidates.length}`);
      logger.info(`================================================================================`);

      return { assigned: true, partner: best, shopDistKm: best.distKm ?? undefined };
    } catch (err) {
      logger.error(`[QcOrderAutoAssign] Error during auto-assignment for order ${orderId}:`, err);
      return { assigned: false, reason: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  /**
   * Persist the assignment to the QC order document in the customerorders collection.
   */
  private static async persistOrderAssignment(
    order: QcOrderShopInfo,
    partner: PartnerCandidate,
  ): Promise<void> {
    const conn = await QcDatabase.getQcConnection();
    const CustomerOrder = conn.collection('customerorders');

    const now = new Date();

    await CustomerOrder.updateOne(
      { _id: new mongoose.Types.ObjectId(order.orderId) },
      {
        $set: {
          assigneeUid: partner.uid,
          assigneeId: partner.profileId,
          assigneeName: partner.name,
          partnerUid: partner.uid,
          partnerId: partner.profileId,
          assignedHelperName: partner.name,
          assignedToName: partner.name,
          assignedAt: now,
          assignmentStatus: 'assigned',
          status: 'assigned',
        },
      },
    );

    // Send notification to the assigned partner
    try {
      await NotificationClient.send({
        eventKey: 'BOOK_NOW_PARTNER_ASSIGNED',
        category: 'taskUpdates',
        recipients: [partner.uid],
        entity: { type: 'task', id: order.orderId },
        title: 'New Quick Commerce Order Assigned!',
        body: `${order.shopName || 'Quick Commerce'} delivery - Tap to view details`,
        data: {
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          shopName: order.shopName,
          bookingSource: 'quick_commerce',
          eventKey: 'BOOK_NOW_PARTNER_ASSIGNED',
          distance: partner.distKm != null ? Number(partner.distKm.toFixed(1)) : undefined,
          partnerName: partner.name,
        },
      });
    } catch (notifErr) {
      logger.warn('[QcOrderAutoAssign] Failed to send assignment notification', {
        orderId: order.orderId,
        partnerUid: partner.uid,
        error: (notifErr as Error)?.message,
      });
    }
  }

  /**
   * Resolve shop coordinates from seller onboarding for an order.
   * Used when calling auto-assign from the QC backend.
   */
  static async resolveShopCoordinates(
    sellerId?: string,
    shopName?: string,
  ): Promise<[number, number] | null> {
    if (!sellerId && !shopName) return null;

    try {
      const conn = await QcDatabase.getQcConnection();
      const SellerOnboarding = conn.collection('selleronboardings');

      let seller: any = null;
      if (sellerId) {
        const sId = String(sellerId);
        const query = mongoose.Types.ObjectId.isValid(sId)
          ? { $or: [{ sellerId: new mongoose.Types.ObjectId(sId) }, { _id: new mongoose.Types.ObjectId(sId) }, { sellerId: sId }] }
          : { sellerId: sId };
        seller = await SellerOnboarding.findOne(query);
      }
      if (!seller && shopName) {
        seller = await SellerOnboarding.findOne({ shopName });
      }

      if (seller?.longitude && seller?.latitude) {
        return [seller.longitude, seller.latitude];
      }
    } catch (err) {
      logger.debug('[QcOrderAutoAssign] Could not resolve shop coordinates:', err);
    }

    return null;
  }
}
