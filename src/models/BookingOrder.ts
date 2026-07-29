import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type BookingOrderStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'paid'
  | 'assigning'
  | 'assigned'
  | 'cancelled'
  | 'refunded';

/** Visit scheduling mode for a single BookingOrder (Instant | Scheduled). Not recurring. */
export type BookingFulfillmentType = 'instant' | 'scheduled';

export interface IBookingAddress {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  pinCode: string;
  coordinates?: [number, number];
}

export interface IBookingOrder extends Document {
  orderId: string;
  customerUid: string;
  customerProfileId: Types.ObjectId;
  status: BookingOrderStatus;
  address: IBookingAddress;
  /**
   * How this visit starts. Missing on legacy package orders ⇒ treat as `scheduled`.
   * Recurring is a future RecurringPlan — never a fulfillmentType value.
   */
  fulfillmentType?: BookingFulfillmentType;
  scheduledDate?: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: 'morning' | 'midday' | 'afternoon' | 'evening';
  subtotal: number;
  addonsTotal: number;
  platformFee: number;
  gst: number;
  total: number;
  paymentEscrowId?: string;
  razorpayOrderId?: string;
  paidAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  /** Customer soft-delete — hide from customer booking lists only. */
  isDeletedByCustomer?: boolean;
  deletedByCustomerAt?: Date;
  deletedByCustomerId?: string;
  /** Serialized cart lines — tasks are created only after payment succeeds. */
  pendingLines?: Record<string, unknown>[];
  bookingNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookingOrderSchema = new Schema<IBookingOrder>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    customerUid: { type: String, required: true, index: true },
    customerProfileId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'awaiting_payment', 'paid', 'assigning', 'assigned', 'cancelled', 'refunded'],
      default: 'awaiting_payment',
      index: true,
    },
    address: {
      label: String,
      line1: { type: String, required: true },
      line2: String,
      city: { type: String, required: true },
      state: String,
      pinCode: { type: String, required: true },
      coordinates: [Number],
    },
    fulfillmentType: {
      type: String,
      enum: ['instant', 'scheduled'],
      required: false,
    },
    scheduledDate: Date,
    scheduledTimeStart: String,
    scheduledTimeEnd: String,
    timeSlot: { type: String, enum: ['morning', 'midday', 'afternoon', 'evening'] },
    subtotal: { type: Number, required: true, min: 0 },
    addonsTotal: { type: Number, default: 0, min: 0 },
    platformFee: { type: Number, default: 0, min: 0 },
    gst: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentEscrowId: String,
    razorpayOrderId: String,
    paidAt: Date,
    cancelledAt: Date,
    cancellationReason: String,
    isDeletedByCustomer: { type: Boolean, default: false, index: true },
    deletedByCustomerAt: Date,
    deletedByCustomerId: { type: String, index: true },
    pendingLines: { type: [Schema.Types.Mixed], default: undefined },
    bookingNotes: String,
  },
  { timestamps: true }
);

BookingOrderSchema.index(
  { fulfillmentType: 1, status: 1, createdAt: -1 },
  { sparse: true, name: 'booking_fulfillment_status_created' },
);

const BookingOrder: Model<IBookingOrder> =
  mongoose.models.BookingOrder || mongoose.model<IBookingOrder>('BookingOrder', BookingOrderSchema);

export default BookingOrder;
