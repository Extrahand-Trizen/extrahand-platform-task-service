import mongoose from 'mongoose';
import { BookingService, type BookingLineInput } from '../services/BookingService';
import type { BookingAddress } from '../services/BookingService';
import { BadRequestError } from '../errors/AppError';
import type {
  FulfilmentCreateInput,
  FulfilmentCreateResult,
  FulfilmentTaskCreator,
} from '../recurring-core/interfaces';

export class BookNowTaskCreator implements FulfilmentTaskCreator {
  async createVisitOrder(input: FulfilmentCreateInput): Promise<FulfilmentCreateResult> {
    const result = await BookingService.createBooking({
      customerUid: input.customerUid,
      customerProfileId: new mongoose.Types.ObjectId(input.customerProfileId),
      items: input.items as BookingLineInput[],
      address: input.address as BookingAddress,
      scheduledDate: input.scheduledDate,
      scheduledTimeStart: input.scheduledTimeStart,
      scheduledTimeEnd: input.scheduledTimeEnd,
      notes: input.notes,
      fulfillmentType: 'scheduled',
      preferredPartnerUid: input.preferredPartnerId,
      recurringPlanId: input.recurringPlanId,
      recurringVisitId: input.recurringVisitId,
      serviceRecipient: input.serviceRecipient,
    });

    const orderId = result.order.orderId;
    if (!orderId) throw new BadRequestError('Failed to create visit booking');

    return {
      bookingOrderId: orderId,
      escrowId: result.order.paymentEscrowId,
      razorpayOrder: result.razorpayOrder,
      total: result.order.total,
    };
  }

  async cancelVisitOrder(bookingOrderId: string, customerUid: string, reason?: string) {
    try {
      await BookingService.cancelBooking(bookingOrderId, customerUid, reason);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Refund failed for this visit',
      };
    }
  }

  async abandonUnpaidOrder(bookingOrderId: string, customerUid: string): Promise<void> {
    await BookingService.abandonUnpaidBooking(bookingOrderId, customerUid);
  }

  async rescheduleVisitOrder(
    bookingOrderId: string,
    customerUid: string,
    params: { scheduledDate: string; scheduledTimeStart: string; scheduledTimeEnd?: string; reason?: string },
  ): Promise<void> {
    await BookingService.rescheduleOrder(bookingOrderId, customerUid, params);
  }
}
