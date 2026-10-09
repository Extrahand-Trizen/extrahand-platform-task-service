import mongoose, { Schema, Model, Document } from 'mongoose';
import type { VisitPaymentStatus, VisitStatus } from '../types/recurringVisitSchedule';

/** Legacy schedule statuses retained for migrated legacy recurring rows. */
export type RecurringVisitStatus =
  | 'open'
  | 'reserved'
  | 'assigned'
  | 'completed'
  | 'cancelled'
  | VisitStatus;

export interface IRecurringVisitRescheduleRequest {
  requestedBy: 'customer' | 'tasker';
  status: 'pending' | 'approved' | 'rejected';
  newDate: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  reason?: string;
  requestedAt: Date;
  respondedAt?: Date;
}

export interface IRecurringVisitCancelRequest {
  requestedBy: 'tasker';
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  requestedAt: Date;
  respondedAt?: Date;
}

export interface IRecurringVisitPriceSnapshot {
  basePrice: number;
  platformFee: number;
  gst: number;
  totalPrice: number;
  currency: 'INR';
  pricedAt: Date;
}

export interface IRecurringVisit extends Document {
  /** Post Work parent task. Book Now stores the RecurringPlan id here for unique indexes. */
  parentTaskId?: mongoose.Types.ObjectId | null;
  planId?: mongoose.Types.ObjectId | null;
  serviceType?: 'post_work' | 'book_now';
  visitId: string;
  visitIndex: number;

  date: Date;
  scheduledAt?: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  expectedDurationMinutes?: number;

  status: RecurringVisitStatus;
  paymentStatus: VisitPaymentStatus;

  escrowId?: string;
  paymentDeadline?: Date;
  paidAt?: Date;
  amount?: number;

  assigneeId?: mongoose.Types.ObjectId | null;
  assigneeUid?: string | null;

  childTaskId?: mongoose.Types.ObjectId | null;
  bookingOrderId?: string | null;
  priceSnapshot?: IRecurringVisitPriceSnapshot;
  paymentOpenedAt?: Date;

  skippedAt?: Date;
  skippedBy?: string;
  skipReason?: string;

  paymentReminderSentAt?: Date;
  cancellationChargeAmount?: number;

  rescheduleRequest?: IRecurringVisitRescheduleRequest;
  cancelRequest?: IRecurringVisitCancelRequest;

  createdAt: Date;
  updatedAt: Date;
}

const RescheduleRequestSchema = new Schema(
  {
    requestedBy: { type: String, enum: ['customer', 'tasker'] },
    status: { type: String, enum: ['pending', 'approved', 'rejected'] },
    newDate: Date,
    scheduledTimeStart: String,
    scheduledTimeEnd: String,
    reason: String,
    requestedAt: Date,
    respondedAt: Date,
  },
  { _id: false },
);

const CancelRequestSchema = new Schema(
  {
    requestedBy: { type: String, enum: ['tasker'] },
    status: { type: String, enum: ['pending', 'approved', 'rejected'] },
    reason: String,
    requestedAt: Date,
    respondedAt: Date,
  },
  { _id: false },
);

const RecurringVisitSchema = new Schema<IRecurringVisit>(
  {
    parentTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      required: false,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'RecurringPlan',
      required: false,
      index: true,
    },
    serviceType: {
      type: String,
      enum: ['post_work', 'book_now'],
      default: 'post_work',
      index: true,
    },
    visitId: { type: String, required: true, trim: true },
    visitIndex: { type: Number, required: true, min: 1 },

    date: { type: Date, required: true },
    scheduledAt: Date,
    scheduledTimeStart: String,
    scheduledTimeEnd: String,
    expectedDurationMinutes: Number,

    status: {
      type: String,
      enum: [
        'open',
        'reserved',
        'assigned',
        'completed',
        'cancelled',
        'scheduled',
        'payment_pending',
        'confirmed',
        'in_progress',
        'skipped',
        'skipped_unpaid',
        'cancelled_late',
      ],
      default: 'scheduled',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['not_required', 'pending', 'held', 'released', 'refunded', 'failed'],
      default: 'not_required',
      index: true,
    },

    escrowId: String,
    paymentDeadline: Date,
    paidAt: Date,
    amount: Number,

    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: 'Profile',
      default: null,
    },
    assigneeUid: { type: String, default: null },

    childTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    bookingOrderId: { type: String, default: null, index: true },
    priceSnapshot: {
      basePrice: Number,
      platformFee: Number,
      gst: Number,
      totalPrice: Number,
      currency: { type: String, default: 'INR' },
      pricedAt: Date,
    },
    paymentOpenedAt: Date,

    skippedAt: Date,
    skippedBy: String,
    skipReason: String,

    paymentReminderSentAt: Date,
    cancellationChargeAmount: Number,

    rescheduleRequest: { type: RescheduleRequestSchema, default: undefined },
    cancelRequest: { type: CancelRequestSchema, default: undefined },
  },
  { timestamps: true },
);

RecurringVisitSchema.index({ parentTaskId: 1, visitId: 1 }, { unique: true, sparse: true });
RecurringVisitSchema.index({ parentTaskId: 1, visitIndex: 1 }, { unique: true, sparse: true });
RecurringVisitSchema.index({ planId: 1, visitId: 1 }, { unique: true, sparse: true });
RecurringVisitSchema.index({ planId: 1, visitIndex: 1 }, { unique: true, sparse: true });
RecurringVisitSchema.index({ parentTaskId: 1, date: 1 });
RecurringVisitSchema.index({ parentTaskId: 1, status: 1, date: 1 });
RecurringVisitSchema.index({ parentTaskId: 1, paymentStatus: 1, date: 1 });
RecurringVisitSchema.index({ planId: 1, status: 1, scheduledAt: 1 });
RecurringVisitSchema.index({ status: 1, paymentDeadline: 1 });
RecurringVisitSchema.index({ serviceType: 1, status: 1, scheduledAt: 1 });
RecurringVisitSchema.index({ childTaskId: 1 }, { sparse: true });
RecurringVisitSchema.index({ assigneeId: 1, status: 1, date: 1 });

const RecurringVisit: Model<IRecurringVisit> =
  mongoose.models.RecurringVisit ||
  mongoose.model<IRecurringVisit>('RecurringVisit', RecurringVisitSchema);

export default RecurringVisit;
