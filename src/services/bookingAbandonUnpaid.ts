/**
 * Shared unpaid Book Now abandon — used by BookingService and hourly cancellation orchestrator.
 * Keeps abandon logic out of a circular BookingService ↔ orchestrator import.
 */

import BookingItem from '../models/BookingItem';
import BookingOrder from '../models/BookingOrder';
import Task from '../models/Task';
import { ForbiddenError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';

export async function abandonUnpaidBookingOrder(orderId: string, customerUid: string) {
  const order = await BookingOrder.findOne({ orderId });
  if (!order) throw new NotFoundError('Booking not found');
  if (order.customerUid !== customerUid) throw new ForbiddenError('Not your booking');
  if (order.status !== 'awaiting_payment' || order.paidAt) {
    return { order, abandoned: false };
  }

  const items = await BookingItem.find({ orderId });
  for (const item of items) {
    if (item.taskId) {
      await Task.findByIdAndDelete(item.taskId);
    }
    await BookingItem.findByIdAndDelete(item._id);
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = 'Payment not completed';
  order.pendingLines = undefined;
  await order.save();

  logger.info('Abandoned unpaid Book Now checkout', { orderId, customerUid });
  return { order, abandoned: true };
}
