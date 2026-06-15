import mongoose from 'mongoose';
import Assignment from '../models/Assignment';
import AssignmentLog from '../models/AssignmentLog';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import Task from '../models/Task';
import { PaymentClient } from './PaymentClient';
import { TaskTransitionService } from './TaskTransitionService';
import { NotificationClient } from './NotificationClient';
import { NOTIFICATION_EVENT_KEYS } from '../constants/notifications';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';

export class AssignmentService {
  static async listPendingAssignments(limit = 50, page = 1) {
    const skip = (Math.max(page, 1) - 1) * limit;
    const query = { status: { $in: ['assigning', 'dispatching'] } };
    const [orders, total] = await Promise.all([
      BookingOrder.find(query).sort({ paidAt: 1 }).skip(skip).limit(limit).lean(),
      BookingOrder.countDocuments(query),
    ]);

    const orderIds = orders.map((o) => o.orderId);
    const items = await BookingItem.find({ orderId: { $in: orderIds } }).lean();
    const taskIds = items.map((i) => i.taskId).filter(Boolean);
    const tasks = await Task.find({ _id: { $in: taskIds } }).lean();

    return {
      orders,
      items,
      tasks,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  static async assignHelper(params: {
    orderId: string;
    helperUid: string;
    helperProfileId: mongoose.Types.ObjectId;
    assignedByUid: string;
    bookingItemId?: string;
  }) {
    const { orderId, helperUid, helperProfileId, assignedByUid, bookingItemId } = params;

    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (!['paid', 'assigning', 'dispatching'].includes(order.status)) {
      throw new BadRequestError(`Cannot assign helper when order status is ${order.status}`);
    }

    const itemQuery: Record<string, unknown> = { orderId };
    if (bookingItemId) itemQuery._id = bookingItemId;
    const item = await BookingItem.findOne(itemQuery);
    if (!item?.taskId) throw new NotFoundError('Booking item or task not found');

    const task = await Task.findById(item.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (task.bookingSource !== 'book_now') {
      throw new BadRequestError('Task is not a Book Now booking');
    }
    if (task.assigneeId) {
      throw new BadRequestError('Task already has an assignee');
    }

    const existingAssignment = await Assignment.findOne({
      bookingOrderId: orderId,
      bookingItemId: item._id,
      status: 'assigned',
    });
    if (existingAssignment) {
      throw new BadRequestError('Helper already assigned for this item');
    }

    const assignment = await Assignment.create({
      bookingOrderId: orderId,
      bookingItemId: item._id,
      taskId: task._id,
      helperUid,
      helperProfileId,
      assignmentMode: 'manual',
      status: 'assigned',
      assignedByUid,
      assignedAt: new Date(),
    });

    await AssignmentLog.create({
      assignmentId: assignment._id,
      action: 'manual_assign',
      actorUid: assignedByUid,
      metadata: { helperUid, orderId },
    });

    task.assigneeId = helperProfileId;
    task.assignedAt = new Date();
    task.status = 'assigned';
    task.assignmentStatus = 'assigned';
    if (!task.executionProfile) task.executionProfile = 'field_service';
    await task.save();
    await TaskTransitionService.setPartnerExecution(String(task._id), 'assigned');

    if (order.paymentEscrowId) {
      const attach = await PaymentClient.attachPerformerToEscrow({
        escrowId: order.paymentEscrowId,
        performerUid: helperUid,
      });
      if (!attach.success) {
        logger.error('Failed to attach performer to escrow after assignment', {
          orderId,
          escrowId: order.paymentEscrowId,
          error: attach.error,
        });
        throw new BadRequestError(attach.error || 'Failed to attach performer to payment');
      }
    }

    order.status = 'assigned';
    await order.save();

    await NotificationClient.send({
      eventKey: NOTIFICATION_EVENT_KEYS.BOOK_NOW_PARTNER_ASSIGNED,
      category: 'taskUpdates',
      recipients: [order.customerUid],
      entity: { type: 'task', id: String(task._id) },
      title: 'Partner assigned',
      body: 'A partner has been assigned to your booking',
      data: { taskId: String(task._id), orderId },
    }).catch(() => undefined);

    logger.info('Book Now helper assigned', {
      orderId,
      taskId: task._id,
      helperUid,
      assignedByUid,
    });

    return { assignment, order, task, item };
  }
}
