import mongoose from 'mongoose';
import Assignment from '../models/Assignment';
import AssignmentLog from '../models/AssignmentLog';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { PaymentClient } from './PaymentClient';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';
import { NOTIFICATION_EVENT_KEYS } from '../constants/notifications';
import { emitTaskStatusChanged } from '../socket/socketHandlers';
import { NotificationClient } from './NotificationClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';

/**
 * Create (or upsert) a synthetic accepted TaskApplication for a Book Now
 * ops-assigned helper, so the tasker can see the job in their My Work screen.
 *
 * The unique index on (taskId, applicantUid) means we use findOneAndUpdate
 * with upsert so re-assignments don't throw duplicate-key errors.
 */
async function upsertAcceptedApplication(params: {
  taskId: mongoose.Types.ObjectId;
  helperProfileId: mongoose.Types.ObjectId;
  helperUid: string;
  helperName?: string;
  budgetAmount: number;
}): Promise<mongoose.Types.ObjectId> {
  const { taskId, helperProfileId, helperUid, helperName, budgetAmount } = params;

  const application = await TaskApplication.findOneAndUpdate(
    { taskId, applicantUid: helperUid },
    {
      $set: {
        taskId,
        applicantId: helperProfileId,
        applicantUid: helperUid,
        applicantProfile: helperName ? { name: helperName } : undefined,
        status: 'accepted',
        coverLetter: 'Book Now — assigned by operations',
        proposedBudget: {
          amount: budgetAmount,
          currency: 'INR',
          isNegotiable: false,
        },
        negotiation: {
          initialAmount: budgetAmount,
          currentAmount: budgetAmount,
          finalAmount: budgetAmount,
          status: 'accepted',
          lastActionBy: 'poster',
          history: [
            {
              amount: budgetAmount,
              action: 'accept',
              by: 'poster',
              at: new Date(),
            },
          ],
        },
        respondedAt: new Date(),
        respondedToRevisionRound: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return application._id as mongoose.Types.ObjectId;
}

export class AssignmentService {
  static async listPendingAssignments(limit = 50, page = 1) {
    const skip = (Math.max(page, 1) - 1) * limit;
    const query = { status: 'assigning' };
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
    helperName?: string;
    bookingItemId?: string;
  }) {
    const { orderId, helperUid, helperProfileId, assignedByUid, helperName, bookingItemId } = params;

    const order = await BookingOrder.findOne({ orderId });
    if (!order) throw new NotFoundError('Booking not found');
    if (!['paid', 'assigning', 'assigned', 'awaiting_payment'].includes(order.status)) {
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

    // Cancel any existing active assignments for this task
    await Assignment.updateMany(
      {
        taskId: task._id,
        status: { $in: ['assigned', 'pending'] },
      },
      {
        $set: { status: 'cancelled' },
      }
    );

    // Cancel old helper's accepted application so they no longer see this task
    if (task.acceptedApplicationId) {
      await TaskApplication.findByIdAndUpdate(task.acceptedApplicationId, {
        $set: { status: 'cancelled' },
      });
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

    // Create / upsert the accepted TaskApplication so helper sees job in My Work
    const budgetAmount = typeof task.budget === 'object' && task.budget?.amount
      ? task.budget.amount
      : 0;

    const applicationId = await upsertAcceptedApplication({
      taskId: task._id as mongoose.Types.ObjectId,
      helperProfileId,
      helperUid,
      helperName,
      budgetAmount,
    });

    // Update task: assignee fields + acceptedApplicationId
    task.assigneeId = helperProfileId;
    task.assigneeUid = helperUid;
    task.assignedAt = new Date();
    task.status = 'assigned';
    task.assignmentStatus = 'assigned';
    task.acceptedApplicationId = applicationId;
    await task.save();

    // Fire-and-forget escrow attachment — never block assignment on payment errors
    if (order.paymentEscrowId) {
      try {
        const attach = await PaymentClient.attachPerformerToEscrow({
          escrowId: order.paymentEscrowId,
          performerUid: helperUid,
        });
        if (!attach.success) {
          logger.warn('Escrow attachment failed (non-blocking) — assignment proceeded', {
            orderId,
            escrowId: order.paymentEscrowId,
            error: attach.error,
          });
        } else {
          logger.info('Performer attached to escrow', { orderId, escrowId: order.paymentEscrowId });
        }
      } catch (escrowErr: any) {
        logger.warn('Escrow attachment threw error (non-blocking)', {
          orderId,
          error: escrowErr?.message,
        });
      }
    }

    order.status = 'assigned';
    await order.save();

    logger.info('Book Now helper assigned', {
      orderId,
      taskId: task._id,
      helperUid,
      applicationId,
      assignedByUid,
    });

    return { assignment, order, task, item };
  }

  /**
   * Look up booking order info for a task (admin use, no ownership check).
   */
  static async findOrderIdForTaskAdmin(taskId: string): Promise<{ orderId: string; bookingItemId: string } | null> {
    if (!mongoose.Types.ObjectId.isValid(taskId)) return null;

    // First try via Task.bookingOrderId
    const task = await Task.findById(taskId).select('bookingOrderId').lean();
    if (task?.bookingOrderId) {
      const order = await BookingOrder.findOne({ orderId: task.bookingOrderId })
        .select('orderId')
        .lean();
      if (order) {
        const item = await BookingItem.findOne({ orderId: task.bookingOrderId })
          .select('_id')
          .lean();
        return { orderId: task.bookingOrderId, bookingItemId: String(item?._id || '') };
      }
    }

    // Fallback via BookingItem
    const item = await BookingItem.findOne({ taskId: new mongoose.Types.ObjectId(taskId) })
      .select('orderId')
      .lean();
    if (!item?.orderId) return null;

    return { orderId: item.orderId, bookingItemId: String(item._id || '') };
  }

  /**
   * Directly assign helper (fallback for tasks without booking orders).
   * Also creates a synthetic accepted TaskApplication for My Work visibility.
   */
  static async assignHelperDirect(params: {
    taskId: string;
    helperUid: string;
    helperProfileId: string;
    helperName?: string;
    assignedByUid: string;
  }) {
    const { taskId, helperUid, helperProfileId, helperName, assignedByUid } = params;

    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError('Task not found');

    // Cancel existing active assignments
    await Assignment.updateMany(
      {
        taskId: task._id,
        status: { $in: ['assigned', 'pending'] },
      },
      {
        $set: { status: 'cancelled' },
      }
    );

    // Cancel old helper's accepted application so they no longer see this task
    if (task.acceptedApplicationId) {
      await TaskApplication.findByIdAndUpdate(task.acceptedApplicationId, {
        $set: { status: 'cancelled' },
      });
    }

    const helperProfileObjId = new mongoose.Types.ObjectId(helperProfileId);

    // Create assignment record for logs/audits
    const assignment = await Assignment.create({
      bookingOrderId: task.bookingOrderId || 'direct',
      taskId: task._id,
      helperUid,
      helperProfileId: helperProfileObjId,
      assignmentMode: 'manual',
      status: 'assigned',
      assignedByUid,
      assignedAt: new Date(),
    });

    await AssignmentLog.create({
      assignmentId: assignment._id,
      action: 'manual_assign_direct',
      actorUid: assignedByUid,
      metadata: { helperUid },
    });

    // Create / upsert the accepted TaskApplication so helper sees job in My Work
    const budgetAmount = typeof task.budget === 'object' && task.budget?.amount
      ? task.budget.amount
      : 0;

    const applicationId = await upsertAcceptedApplication({
      taskId: task._id as mongoose.Types.ObjectId,
      helperProfileId: helperProfileObjId,
      helperUid,
      helperName,
      budgetAmount,
    });

    task.assigneeId = helperProfileObjId;
    task.assigneeUid = helperUid;
    task.assignedAt = new Date();
    task.status = 'assigned';
    task.assignmentStatus = 'assigned';
    task.acceptedApplicationId = applicationId;
    await task.save();

    logger.info('Direct helper assigned', {
      taskId: task._id,
      helperUid,
      applicationId,
      assignedByUid,
    });

    return { assignment, task };
  }

  static async unassignHelper(params: {
    taskId: string;
    escrowId?: string;
    unassignedByUid: string;
  }) {
    const { taskId, escrowId, unassignedByUid } = params;

    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError('Task not found');

    const oldHelperUid = task.assigneeUid;

    const activeAssignment = await Assignment.findOne({
      taskId: task._id,
      status: { $in: ['assigned', 'pending'] },
    });

    // Cancel existing active assignments
    await Assignment.updateMany(
      {
        taskId: task._id,
        status: { $in: ['assigned', 'pending'] },
      },
      { $set: { status: 'cancelled' } }
    );

    if (activeAssignment) {
      await AssignmentLog.create({
        assignmentId: activeAssignment._id,
        action: 'manual_unassign',
        actorUid: unassignedByUid,
        metadata: { oldHelperUid },
      });
    } else {
      logger.info('No active assignment record found for unassignment log', { taskId: task._id });
    }

    // Remove/cancel the accepted application
    if (task.acceptedApplicationId) {
      await TaskApplication.findByIdAndUpdate(task.acceptedApplicationId, {
        $set: { status: 'cancelled' },
      });
    }

    // Reset task fields
    task.assigneeId = null;
    task.assigneeUid = null;
    task.assignedAt = undefined;
    task.status = 'open';
    task.assignmentStatus = undefined;
    task.acceptedApplicationId = null;
    await task.save();

    // Reset escrow performer to pending_assignment
    if (escrowId) {
      try {
        await PaymentClient.detachPerformerFromEscrow(escrowId);
      } catch (err: any) {
        logger.warn('Failed to detach performer from escrow (non-blocking)', {
          escrowId,
          error: err?.message,
        });
      }
    }

    // Emit socket event so customer & helper UIs update in real-time
    try {
      const taskJson = task.toObject();
      emitTaskStatusChanged(taskId, taskJson);
    } catch (err: any) {
      logger.warn('Failed to emit socket event on unassign', { taskId, error: err?.message });
    }

    // Notify customer that helper was unassigned
    if (task.requesterUid) {
      try {
        await InAppNotificationClient.send({
          userId: task.requesterUid,
          title: 'Helper unassigned',
          body: `The helper assigned to your task "${task.title}" has been unassigned by operations.`,
          type: 'info',
          category: 'taskUpdates',
          data: { taskId, action: 'unassigned' },
        });
      } catch (err: any) {
        logger.warn('Failed to send unassign notification to customer', { taskId, error: err?.message });
      }
    }

    // Notify old helper that they were unassigned
    if (oldHelperUid) {
      try {
        await InAppNotificationClient.send({
          userId: oldHelperUid,
          title: 'Task unassigned',
          body: `You have been unassigned from task "${task.title}" by operations.`,
          type: 'info',
          category: 'taskUpdates',
          data: { taskId, action: 'unassigned' },
        });

        await NotificationClient.send({
          eventKey: NOTIFICATION_EVENT_KEYS.TASK_UPDATED,
          category: 'taskUpdates',
          actorId: unassignedByUid,
          recipients: [oldHelperUid],
          entity: { type: 'task', id: taskId },
          title: 'Task unassigned',
          body: `You have been unassigned from task "${task.title}" by operations.`,
          data: { taskId, action: 'unassigned' },
        });
      } catch (err: any) {
        logger.warn('Failed to send unassign notification to helper', { taskId, error: err?.message });
      }
    }

    logger.info('Helper unassigned from Book Now task', {
      taskId,
      oldHelperUid,
      unassignedByUid,
    });

    return { task };
  }
}
