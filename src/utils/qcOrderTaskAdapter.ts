import mongoose from 'mongoose';
import logger from '../config/logger';
import { QcDatabase } from '../config/qcDatabase';
import { QC_DEFAULT_DELIVERY_FEE_INR } from '../constants/quickCommerce';

/**
 * Normalizes a raw customerorders document into an ITask-compatible shape
 * so that all task endpoints, workflows, and mobile screens handle Quick Commerce works
 * identically to Book Now tasks.
 */
export function normalizeQcOrderToTask(order: Record<string, any>): Record<string, any> {
  if (!order) return order;

  const orderIdStr = String(order._id);
  const deliveryFee = (order.deliveryFeePaise ?? 0) / 100;
  const totalAmount = (order.amountPaise ?? (order.amount ? order.amount * 100 : 0)) / 100;
  const budgetAmount =
    typeof order.budget === 'object' && order.budget?.amount
      ? order.budget.amount
      : typeof order.budget === 'object' && order.budget?.max
        ? order.budget.max
          : deliveryFee > 0
          ? deliveryFee
          : QC_DEFAULT_DELIVERY_FEE_INR;

  let customerCoordinates: [number, number] | undefined = undefined;
  if (order.location?.coordinates && Array.isArray(order.location.coordinates)) {
    customerCoordinates = order.location.coordinates;
  } else if (order.address?.coordinates && Array.isArray(order.address.coordinates)) {
    customerCoordinates = order.address.coordinates;
  }

  const customerAddress =
    order.location?.address ||
    [order.address?.line1, order.address?.line2, order.address?.city, order.address?.state, order.address?.pinCode]
      .filter(Boolean)
      .join(', ') ||
    '6-6-7, B-57-7, Thagarapuvalasa, Andhra Pradesh 531162';

  const customerName = order.address?.name || order.customerName || 'Testing User';

  const shopName = order.shopName || 'ABC Supermarket';
  const shopAddress = order.shopAddress || '6-6-7, Main Road, Thagarapuvalasa, Andhra Pradesh 531162';
  const shopCoordinates = order.shopCoordinates || [83.3650814, 18.5717122];

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

  const itemsSummary = itemsList.map((i: any) => `${i.quantity}x ${i.name}`).join(', ');

  const orderNum = order.orderNumber ? String(order.orderNumber).replace(/^#/, '') : orderIdStr.slice(-5);
  const title = order.title || 'Quick Commerce Order';
  const description =
    order.description ||
    (itemsSummary
      ? `Quick commerce delivery: ${itemsSummary}`
      : `Quick commerce delivery #${orderNum}`);

  // Resolve status to TaskStatus enum
  let status = order.status || 'assigned';
  const hasPartnerAssigned = Boolean(
    order.assigneeId ||
      order.partnerId ||
      order.assignedTo?.userId ||
      order.assignedTo?.profileId ||
      order.assigneeUid ||
      order.partnerUid,
  );

  if (
    [
      'PAID',
      'PLACED',
      'CONFIRMED',
      'PENDING_ACCEPT',
      'ACCEPTED',
      'PREPARING',
      'READY',
    ].includes(status)
  ) {
    status = hasPartnerAssigned ? 'assigned' : 'open';
  } else if (status === 'HANDED_OVER' || status === 'OUT_FOR_DELIVERY') {
    status = 'in_progress';
  } else if (status === 'DELIVERED') {
    status = 'completed';
  }

  const assigneeProfileId =
    order.assigneeId ||
    order.partnerId ||
    (order.assignedTo?.profileId
      ? mongoose.Types.ObjectId.isValid(order.assignedTo.profileId)
        ? new mongoose.Types.ObjectId(order.assignedTo.profileId)
        : order.assignedTo.profileId
      : null);

  const assigneeUid =
    order.assigneeUid ||
    order.partnerUid ||
    order.assignedTo?.userId ||
    null;

  const requesterProfileId =
    order.requesterId ||
    (order.userId && mongoose.Types.ObjectId.isValid(order.userId)
      ? new mongoose.Types.ObjectId(order.userId)
      : null);

  const city = order.address?.city || order.location?.city || order.shopCity || 'Thagarapuvalasa';

  return {
    _id: order._id,
    id: orderIdStr,
    title,
    description,
    category: 'delivery',
    categorySlug: 'quick_commerce',
    categoryLabel: 'Quick Commerce',
    subcategory: 'quick_commerce_delivery',
    status,
    budget: {
      min: budgetAmount,
      max: budgetAmount,
      currency: 'INR',
      amount: budgetAmount,
      type: 'fixed',
    },
    location: {
      type: 'Point',
      coordinates: customerCoordinates || [83.3641136, 18.5723811],
      address: customerAddress,
      city,
      locality: city,
      taskArea: order.location?.taskArea || order.address?.area || city,
    },
    scheduledDate: order.scheduledDate || order.createdAt || new Date(),
    scheduledTimeStart: order.scheduledTimeStart || '05:30 AM',
    scheduledTimeEnd: order.scheduledTimeEnd || '',
    dateOption: 'specific',
    urgency: order.urgency || 'urgent',
    priority: order.priority || 'high',
    bookingSource: 'quick_commerce',
    bookingOrderId: order.bookingOrderId || orderNum,
    bookingItemId:
      order.bookingItemId ||
      (order.items?.[0]?._id ? String(order.items[0]._id) : orderIdStr),
    requesterId: requesterProfileId,
    requesterUid: order.requesterUid || order.userId || 'system_qc',
    requesterName: customerName,
    assigneeId: assigneeProfileId,
    assigneeUid,
    partnerId: assigneeProfileId,
    partnerUid: assigneeUid,
    assignedHelperName: order.assignedHelperName || order.assignedTo?.name || null,
    assignedToName: order.assignedToName || order.assignedTo?.name || null,
    assigneeName: order.assigneeName || order.assignedTo?.name || null,
    assignedAt: order.assignedAt || order.assignedTo?.assignedAt || order.createdAt,
    assignmentStatus: order.assignmentStatus || (assigneeProfileId ? 'assigned' : 'pending'),
    confirmed: Boolean(order.confirmed),
    confirmedAt: order.confirmedAt || order.confirmed_at || null,
    confirmed_at: order.confirmedAt || order.confirmed_at || null,
    // Customer live journey uses explicit executionPhase from start-otp/send + mark-arrived.
    // Do not infer on_the_way/arrived from Book Now lead statuses (started = to store, in_progress = picked up).
    executionPhase:
      order.executionPhase ||
      (order.arrivedAt ? 'arrived' : order.onTheWayAt ? 'on_the_way' : 'assigned'),
    onTheWayAt: order.onTheWayAt,
    arrivedAt: order.arrivedAt,
    startOtp: order.startOtp,
    startedAt: order.startedAt,
    inProgressAt: order.inProgressAt,
    reviewAt: order.reviewAt,
    completedAt: order.completedAt,
    completionStatus: order.completionStatus || (status === 'completed' ? 'approved' : null),
    completionApprovedAt: order.completionApprovedAt,
    createdAt: order.createdAt || new Date(),
    updatedAt: order.updatedAt || new Date(),
    isQCommerce: true,
    fulfillmentStatus: order.fulfillmentStatus || null,
    items: itemsList,
    shopName,
    shopAddress,
    shopCoordinates,
    customerName,
    customerAddress,
    customerCoordinates: customerCoordinates || [83.3641136, 18.5723811],
    orderNumber: orderNum,
    amount: totalAmount,
    amountPaise: order.amountPaise,
    deliveryFee: budgetAmount,
    deliveryFeePaise: order.deliveryFeePaise || budgetAmount * 100,
    address: order.address,
    equals(otherId: any) {
      return String(order._id) === String(otherId);
    },
  };
}

async function getQcCollections() {
  try {
    const conn = await QcDatabase.getQcConnection();
    return {
      CustomerOrders: conn.collection('customerorders'),
      SellerOnboardings: conn.collection('selleronboardings'),
    };
  } catch (err) {
    logger.warn('[qcOrderTaskAdapter] Fallback to primary mongoose connection for QC collections:', err);
    return {
      CustomerOrders: mongoose.connection.collection('customerorders'),
      SellerOnboardings: mongoose.connection.collection('selleronboardings'),
    };
  }
}

async function enrichOrderWithSeller(order: any, SellerOnboardings: any) {
  if (!order) return order;
  try {
    let seller: any = null;
    if (order.sellerId) {
      const sId = String(order.sellerId);
      const query = mongoose.Types.ObjectId.isValid(sId)
        ? { $or: [{ sellerId: new mongoose.Types.ObjectId(sId) }, { _id: new mongoose.Types.ObjectId(sId) }, { sellerId: sId }] }
        : { sellerId: sId };
      seller = await SellerOnboardings.findOne(query);
    }
    if (!seller && order.shopName) {
      seller = await SellerOnboardings.findOne({ shopName: order.shopName });
    }
    if (seller) {
      if (!order.shopName && seller.shopName) order.shopName = seller.shopName;
      if (!order.shopAddress) {
        order.shopAddress =
          seller.formattedAddress ||
          seller.address ||
          [seller.area, seller.locality, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ');
      }
      if (seller.longitude && seller.latitude && !order.shopCoordinates) {
        order.shopCoordinates = [seller.longitude, seller.latitude];
      }
    }
  } catch (err) {
    logger.debug('[qcOrderTaskAdapter] Could not enrich order with seller details:', err);
  }

  if (!order.shopName) order.shopName = 'ABC Supermarket';
  if (!order.shopAddress) order.shopAddress = '6-6-7, Main Road, Thagarapuvalasa, Andhra Pradesh 531162';
  if (!order.shopCoordinates) order.shopCoordinates = [83.3650814, 18.5717122];

  return order;
}

/**
 * Find a quick commerce order by ID from customerorders collection
 */
export async function findQcOrderById(taskId: string | mongoose.Types.ObjectId): Promise<any | null> {
  try {
    const { CustomerOrders, SellerOnboardings } = await getQcCollections();
    const query = mongoose.Types.ObjectId.isValid(String(taskId))
      ? { _id: new mongoose.Types.ObjectId(String(taskId)) }
      : { orderNumber: taskId };
    const order = await CustomerOrders.findOne(query);
    if (!order) return null;
    return await enrichOrderWithSeller(order, SellerOnboardings);
  } catch (err) {
    logger.warn('[qcOrderTaskAdapter] Error finding QC order by ID:', { taskId, error: err });
    return null;
  }
}

/**
 * Find all assigned quick commerce orders for a partner
 */
export async function findQcOrdersForPartner(
  partnerOid: mongoose.Types.ObjectId,
  uid: string,
): Promise<any[]> {
  try {
    const { CustomerOrders, SellerOnboardings } = await getQcCollections();
    const orders = await CustomerOrders.find({
      $or: [
        { partnerId: partnerOid },
        { assigneeId: partnerOid },
        { partnerUid: uid },
        { assigneeUid: uid },
        { 'assignedTo.userId': uid },
        { 'assignedTo.profileId': String(partnerOid) },
      ],
      status: {
        $in: [
          'assigned',
          'started',
          'in_progress',
          'review',
          'completed',
          'cancelled',
          'PAID',
          'open',
        ],
      },
    })
      .sort({ partnerAcceptedAt: -1, assignedAt: -1, createdAt: -1 })
      .toArray();

    return await Promise.all(orders.map((o) => enrichOrderWithSeller(o, SellerOnboardings)));
  } catch (err) {
    logger.warn('[qcOrderTaskAdapter] Error finding QC orders for partner:', {
      partnerOid,
      uid,
      error: err,
    });
    return [];
  }
}

/**
 * Update quick commerce order document in customerorders collection
 */
export async function updateQcOrderById(
  orderId: string | mongoose.Types.ObjectId,
  updateFields: Record<string, any>,
): Promise<any | null> {
  try {
    const { CustomerOrders } = await getQcCollections();
    const query = mongoose.Types.ObjectId.isValid(String(orderId))
      ? { _id: new mongoose.Types.ObjectId(String(orderId)) }
      : { orderNumber: orderId };
    await CustomerOrders.updateOne(query, { $set: updateFields });
    return await CustomerOrders.findOne(query);
  } catch (err) {
    logger.error('[qcOrderTaskAdapter] Error updating QC order:', { orderId, error: err });
    return null;
  }
}
