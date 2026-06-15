import mongoose from 'mongoose';
import Task from '../models/Task';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import Assignment from '../models/Assignment';
import AssignmentOffer from '../models/AssignmentOffer';
import { UserServiceClient } from '../clients/UserServiceClient';
import { TaskTransitionService } from './TaskTransitionService';
import { NotificationClient } from './NotificationClient';
import { NOTIFICATION_EVENT_KEYS } from '../constants/notifications';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';

const OFFER_TTL_SECONDS = parseInt(process.env.BOOK_NOW_OFFER_TTL_SECONDS || '120', 10);
const MAX_CANDIDATES = parseInt(process.env.BOOK_NOW_MAX_BROADCAST_CANDIDATES || '10', 10);
const MAX_ROUNDS = parseInt(process.env.BOOK_NOW_MAX_DISPATCH_ROUNDS || '2', 10);

export class DispatchService {
  static async startBroadcastForOrder(orderId: string) {
    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (!['paid', 'assigning', 'dispatching'].includes(order.status)) {
      throw new BadRequestError(`Cannot dispatch order in status ${order.status}`);
    }

    const items = await BookingItem.find({ orderId });
    for (const item of items) {
      if (item.taskId) {
        await this.startBroadcastForTask(String(item.taskId), orderId);
      }
    }

    order.status = 'dispatching';
    await order.save();
    return { orderId, itemCount: items.length };
  }

  static async startBroadcastForTask(taskId: string, bookingOrderId?: string) {
    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (task.bookingSource !== 'book_now') {
      throw new BadRequestError('Not a Book Now task');
    }
    if (task.assigneeId) {
      throw new BadRequestError('Task already assigned');
    }

    const round = (task.dispatchMeta?.broadcastRound ?? 0) + 1;
    if (round > MAX_ROUNDS) {
      await TaskTransitionService.setPartnerExecution(taskId, 'offer_expired');
      logger.warn('Dispatch max rounds exceeded', { taskId, round });
      return { taskId, offers: 0, round };
    }

    const pinCode = task.location?.pinCode;
    const city = task.location?.city;
    const categorySlug = task.categorySlug || task.subcategory;

    const partners = await UserServiceClient.findEligiblePartners({
      categorySlug,
      pinCode,
      city,
      limit: MAX_CANDIDATES,
      requireOnline: true,
    });

    const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000);
    const orderId = bookingOrderId || task.bookingOrderId || '';

    const offers = [];
    for (const partner of partners) {
      const offer = await AssignmentOffer.create({
        taskId: task._id,
        bookingOrderId: orderId,
        partnerId: new mongoose.Types.ObjectId(partner.profileId),
        partnerUid: partner.uid,
        status: 'offered',
        expiresAt,
        assignmentMode: 'broadcast',
      });
      offers.push(offer);

      await NotificationClient.send({
        eventKey: NOTIFICATION_EVENT_KEYS.BOOK_NOW_OFFER_RECEIVED,
        category: 'taskUpdates',
        recipients: [partner.uid],
        entity: { type: 'task', id: String(task._id) },
        title: 'New job offer',
        body: task.title,
        data: { taskId: String(task._id), offerId: String(offer._id) },
      });
    }

    task.dispatchMeta = {
      broadcastRound: round,
      candidateCount: partners.length,
      lastDispatchAt: new Date(),
    };
    await TaskTransitionService.setPartnerExecution(taskId, offers.length > 0 ? 'offered' : 'awaiting_dispatch', {
      offeredAt: offers.length > 0 ? new Date() : undefined,
      offerExpiresAt: offers.length > 0 ? expiresAt : undefined,
    });

    if (offers.length > 0 && task.bookingItemId) {
      await Assignment.create({
        bookingOrderId: orderId,
        bookingItemId: new mongoose.Types.ObjectId(task.bookingItemId),
        taskId: task._id,
        assignmentMode: 'broadcast',
        status: 'pending',
        offerExpiresAt: expiresAt,
        candidateIds: partners.map((p) => p.uid),
      });
    }

    return { taskId, offers: offers.length, round };
  }

  static async respondToOffer(params: {
    taskId: string;
    partnerUid: string;
    partnerProfileId: string;
    action: 'accept' | 'decline';
  }) {
    const { taskId, partnerUid, partnerProfileId, action } = params;

    const offer = await AssignmentOffer.findOne({
      taskId,
      partnerUid,
      status: 'offered',
      expiresAt: { $gt: new Date() },
    });
    if (!offer) throw new NotFoundError('No active offer found');

    if (action === 'decline') {
      offer.status = 'declined';
      offer.respondedAt = new Date();
      await offer.save();
      return { action: 'declined' };
    }

    const winner = await Task.findOneAndUpdate(
      { _id: taskId, assigneeId: { $exists: false } },
      {
        $set: {
          assigneeId: new mongoose.Types.ObjectId(partnerProfileId),
          assignedAt: new Date(),
          status: 'assigned',
          assignmentStatus: 'assigned',
        },
      },
      { new: true },
    );

    if (!winner) {
      offer.status = 'cancelled';
      offer.respondedAt = new Date();
      await offer.save();
      throw new BadRequestError('Task already assigned to another partner');
    }

    offer.status = 'accepted';
    offer.respondedAt = new Date();
    await offer.save();

    await AssignmentOffer.updateMany(
      { taskId, status: 'offered', _id: { $ne: offer._id } },
      { status: 'cancelled', respondedAt: new Date() },
    );

    await TaskTransitionService.setPartnerExecution(taskId, 'assigned');

    const task = await Task.findById(taskId);
    if (task?.bookingOrderId && task.bookingItemId) {
      await Assignment.findOneAndUpdate(
        { taskId: task._id, status: 'pending' },
        {
          helperUid: partnerUid,
          helperProfileId: new mongoose.Types.ObjectId(partnerProfileId),
          status: 'assigned',
          assignedAt: new Date(),
          acceptedBy: partnerUid,
          respondedAt: new Date(),
          response: 'accepted',
        },
      );

      const order = await BookingOrder.findOne({ orderId: task.bookingOrderId });
      if (order?.paymentEscrowId) {
        const { PaymentClient } = await import('./PaymentClient');
        await PaymentClient.attachPerformerToEscrow({
          escrowId: order.paymentEscrowId,
          performerUid: partnerUid,
        });
      }
      if (order) {
        order.status = 'assigned';
        await order.save();
      }

      await NotificationClient.send({
        eventKey: NOTIFICATION_EVENT_KEYS.BOOK_NOW_PARTNER_ASSIGNED,
        category: 'taskUpdates',
        recipients: [order?.customerUid ?? ''],
        entity: { type: 'task', id: String(task._id) },
        title: 'Partner assigned',
        body: 'A partner has been assigned to your booking',
        data: { taskId: String(task._id), orderId: task.bookingOrderId },
      });
    }

    return { action: 'accepted', task: winner };
  }

  static async expireOffers() {
    const now = new Date();
    const expired = await AssignmentOffer.find({
      status: 'offered',
      expiresAt: { $lte: now },
    });

    for (const offer of expired) {
      offer.status = 'expired';
      offer.respondedAt = now;
      await offer.save();
    }

    const taskIds = [...new Set(expired.map((o) => String(o.taskId)))];
    for (const taskId of taskIds) {
      const stillActive = await AssignmentOffer.countDocuments({
        taskId,
        status: 'offered',
        expiresAt: { $gt: now },
      });
      if (stillActive === 0) {
        const task = await Task.findById(taskId);
        if (task && !task.assigneeId) {
          const round = task.dispatchMeta?.broadcastRound ?? 0;
          if (round < MAX_ROUNDS) {
            await this.startBroadcastForTask(taskId, task.bookingOrderId);
          } else {
            await TaskTransitionService.setPartnerExecution(taskId, 'offer_expired');
          }
        }
      }
    }

    return { expiredCount: expired.length };
  }
}
