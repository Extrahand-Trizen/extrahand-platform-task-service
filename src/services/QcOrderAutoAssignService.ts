import mongoose from 'mongoose';
import logger from '../config/logger';
import { QcDatabase } from '../config/qcDatabase';
import { QC_SHOP_PROXIMITY_KM, QC_AVAILABLE_ORDERS_MAX_DISTANCE_KM, EARTH_RADIUS_KM } from '../constants/quickCommerce';
import { NotificationClient } from './NotificationClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';

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

export interface QcOrderShopInfo {
  orderId: string;
  orderNumber: string;
  sellerId?: string;
  shopName?: string;
  shopCoordinates?: [number, number]; // [longitude, latitude]
  shopAddress?: string;
  deliveryFee?: number;
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

  /**
   * Broadcast push and in-app notifications to all nearby partners (<= 3 km from shop)
   * to whom the Quick Commerce order is currently showing.
   */
  static async notifyNearbyPartners(order: QcOrderShopInfo): Promise<{
    success: boolean;
    notifiedCount: number;
    candidateUids: string[];
    reason?: string;
  }> {
    const orderId = order.orderId;

    try {
      let coords = order.shopCoordinates;
      if (!coords || !Array.isArray(coords) || coords.length !== 2) {
        coords = (await QcOrderAutoAssignService.resolveShopCoordinates(order.sellerId, order.shopName)) ?? undefined;
      }

      if (!coords || coords.length !== 2) {
        logger.info('[QcOrderNotify] No shop coordinates available, skipping notification', {
          orderId,
          orderNumber: order.orderNumber,
        });
        return { success: false, notifiedCount: 0, candidateUids: [], reason: 'No shop coordinates available' };
      }

      const [shopLng, shopLat] = coords;
      if (typeof shopLng !== 'number' || typeof shopLat !== 'number' || (shopLng === 0 && shopLat === 0)) {
        logger.info('[QcOrderNotify] Invalid shop coordinates, skipping notification', {
          orderId,
          orderNumber: order.orderNumber,
        });
        return { success: false, notifiedCount: 0, candidateUids: [], reason: 'Invalid shop coordinates' };
      }

      const Profile = mongoose.connection.collection('profiles');
      const profiles = await Profile.find({
        isActive: true,
        'partnerProfile.status': 'approved',
      }).toArray();

      if (!profiles.length) {
        logger.info('[QcOrderNotify] No active approved partners found', { orderId });
        return { success: true, notifiedCount: 0, candidateUids: [], reason: 'No active approved partners' };
      }

      const maxDistanceKm = QC_AVAILABLE_ORDERS_MAX_DISTANCE_KM; // 3.0 km
      const candidates: PartnerCandidate[] = [];

      for (const p of profiles) {
        const pp = (p.partnerProfile as any) || {};

        // Check active for quick commerce toggle
        const isActiveForQc = pp.activeForQCommerce === true || pp.activeForQCommerceOrders === true;
        if (!isActiveForQc) continue;

        // Check on-leave status
        if (pp.onLeave === true) continue;

        // Resolve partner location (prefer live, fallback to home)
        const homeLoc = (p.homeLocation as { coordinates?: number[] } | undefined)?.coordinates;
        const liveLoc = (p.location as { coordinates?: number[] } | undefined)?.coordinates;
        const partnerCoords =
          Array.isArray(liveLoc) && liveLoc.length === 2 && liveLoc[0] && liveLoc[1]
            ? liveLoc
            : Array.isArray(homeLoc) && homeLoc.length === 2 && homeLoc[0] && homeLoc[1]
            ? homeLoc
            : null;

        if (!partnerCoords) continue;

        const [partnerLng, partnerLat] = partnerCoords;
        if (typeof partnerLng !== 'number' || typeof partnerLat !== 'number' || (partnerLng === 0 && partnerLat === 0)) {
          continue;
        }

        // Calculate distance from partner to seller shop
        const distKm = haversineKm(shopLat, shopLng, partnerLat, partnerLng);

        // Strictly filter to nearby partners (<= 3 km) to whom the order is showing
        if (distKm > maxDistanceKm) continue;

        candidates.push({
          uid: String(p.uid),
          profileId: String(p._id),
          name: (p.name || p.fullName || 'Partner') as string,
          distKm: Number(distKm.toFixed(1)),
          phone: p.phone as string | undefined,
        });
      }

      if (candidates.length === 0) {
        logger.info('[QcOrderNotify] No eligible partners within 3.0 km of shop', {
          orderId,
          orderNumber: order.orderNumber,
          shopName: order.shopName,
          shopLat,
          shopLng,
        });
        return { success: true, notifiedCount: 0, candidateUids: [], reason: 'No eligible partners within 3.0 km' };
      }

      const candidateUids = candidates.map((c) => c.uid);
      const title = 'New Quick Commerce Order Available!';
      const shopName = order.shopName || 'Nearby Store';

      logger.info(`📢 [QcOrderNotify] Broadcasting notification to ${candidates.length} nearby partners for order #${order.orderNumber}: ${candidateUids.join(', ')}`);

      // 1. Send push notifications via NotificationClient to each candidate with localized distance
      await Promise.allSettled(
        candidates.map(async (c) => {
          const distText = c.distKm != null ? `${c.distKm} km away` : 'nearby';
          const body = `New order from ${shopName} (${distText}). Tap to apply now!`;

          try {
            await NotificationClient.send({
              eventKey: 'TASK_NEARBY',
              category: 'recommendedTaskAlerts',
              recipients: [c.uid],
              entity: { type: 'task', id: order.orderId },
              title,
              body,
              data: {
                orderId: order.orderId,
                orderNumber: order.orderNumber,
                shopName: order.shopName,
                bookingSource: 'quick_commerce',
                eventKey: 'TASK_NEARBY',
                action: 'apply_qc_order',
                recipientRole: 'partner',
                distance: c.distKm,
              },
            });
          } catch (notifErr: any) {
            logger.warn(`[QcOrderNotify] Failed to send push to partner ${c.uid}:`, notifErr?.message);
          }
        }),
      );

      // 2. In-App Notification Center
      try {
        await InAppNotificationClient.sendBatch({
          userIds: candidateUids,
          title,
          body: `New Quick Commerce order available from ${shopName}. Tap to apply!`,
          type: 'info',
          category: 'recommendedTaskAlerts',
          data: {
            orderId: order.orderId,
            orderNumber: order.orderNumber,
            shopName: order.shopName,
            bookingSource: 'quick_commerce',
            eventKey: 'TASK_NEARBY',
            action: 'apply_qc_order',
            recipientRole: 'partner',
          },
        });
      } catch (inAppErr: any) {
        logger.warn('[QcOrderNotify] Failed to create in-app notification batch:', inAppErr?.message);
      }

      return { success: true, notifiedCount: candidates.length, candidateUids };
    } catch (err: any) {
      logger.error(`[QcOrderNotify] Error notifying partners for order ${orderId}:`, err);
      return { success: false, notifiedCount: 0, candidateUids: [], reason: err?.message };
    }
  }
}
