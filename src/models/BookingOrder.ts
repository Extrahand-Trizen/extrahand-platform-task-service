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
  /**
   * Snapshot from Hourly Helper cancellation evaluator (idempotency / disputes).
   * Fixed-price Book Now cancel does not use this field.
   */
  cancellationResult?: Record<string, unknown> | null;
  /** Optional coupon snapshot (nullable for historical orders) */
  couponId?: string | null;
  couponCode?: string | null;
  couponDiscount?: number | null;
  totalBeforeCoupon?: number | null;
  totalAfterCoupon?: number | null;
  /** Customer soft-delete — hide from customer booking lists only. */
  isDeletedByCustomer?: boolean;
  deletedByCustomerAt?: Date;
  deletedByCustomerId?: string;
  /** Serialized cart lines — tasks are created only after payment succeeds. */
  pendingLines?: Record<string, unknown>[];
  bookingNotes?: string;
  serviceFlowType?: 'standard' | 'consultation_project';
  bookingKind?: 'standard' | 'consultation' | 'project';
  serviceType?: string;
  pricingProfile?: {
    gstExempt?: boolean;
  };
  consultationMeta?: {
    samePartnerPreferred?: boolean;
    consultationFee?: number;
    customerRequirements?: string;
    sourceTaskId?: string;
    sourceQuotationId?: string;
    projectTitle?: string;
    estimateSnapshot?: {
      amount?: number;
      currency?: string;
      durationLabel?: string;
      notes?: string;
      selections?: Record<string, unknown>;
    };
  };
  rescheduleCount?: number;
  lastRescheduledAt?: Date;
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
    cancellationResult: { type: Schema.Types.Mixed, default: undefined },
    couponId: { type: String, default: null },
    couponCode: { type: String, default: null },
    couponDiscount: { type: Number, default: null, min: 0 },
    totalBeforeCoupon: { type: Number, default: null, min: 0 },
    totalAfterCoupon: { type: Number, default: null, min: 0 },
    isDeletedByCustomer: { type: Boolean, default: false, index: true },
    deletedByCustomerAt: Date,
    deletedByCustomerId: { type: String, index: true },
    pendingLines: { type: [Schema.Types.Mixed], default: undefined },
    bookingNotes: String,
    serviceFlowType: {
      type: String,
      enum: ['standard', 'consultation_project'],
      default: 'standard',
      index: true,
    },
    bookingKind: {
      type: String,
      enum: ['standard', 'consultation', 'project'],
      default: 'standard',
      index: true,
    },
    serviceType: {
      type: String,
      trim: true,
      index: true,
    },
    pricingProfile: {
      gstExempt: { type: Boolean, default: false },
    },
    consultationMeta: {
      samePartnerPreferred: Boolean,
      consultationFee: Number,
      customerRequirements: String,
      sourceTaskId: String,
      sourceQuotationId: String,
      projectTitle: String,
      estimateSnapshot: {
        amount: Number,
        currency: String,
        durationLabel: String,
        notes: String,
        selections: { type: Schema.Types.Mixed, default: undefined },
      },
    },
    rescheduleCount: { type: Number, default: 0, min: 0 },
    lastRescheduledAt: Date,
  },
  { timestamps: true }
);

BookingOrderSchema.index(
  { fulfillmentType: 1, status: 1, createdAt: -1 },
  { sparse: true, name: 'booking_fulfillment_status_created' },
);
BookingOrderSchema.index(
  { bookingKind: 1, serviceType: 1, status: 1, createdAt: -1 },
  { sparse: true, name: 'booking_kind_service_status_created' },
);

const BookingOrder: Model<IBookingOrder> =
  mongoose.models.BookingOrder || mongoose.model<IBookingOrder>('BookingOrder', BookingOrderSchema);

export default BookingOrder;
