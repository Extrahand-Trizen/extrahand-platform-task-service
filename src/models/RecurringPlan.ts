import mongoose, { Schema, Model, Document, Types } from 'mongoose';

export type RecurringPlanServiceType = 'book_now' | 'post_work';
export type RecurringPlanStoredStatus = 'draft' | 'active' | 'paused' | 'cancelled' | 'ended';
export type RecurringPlanPattern = 'weekly' | 'selected_weekdays' | 'biweekly';

export interface IRecurringPlan extends Document {
  serviceType: RecurringPlanServiceType;
  status: RecurringPlanStoredStatus;
  customerUid: string;
  customerProfileId: Types.ObjectId;
  pattern: RecurringPlanPattern;
  selectedWeekdays: number[];
  startDate: Date;
  endDate?: Date;
  scheduledTimeStart: string;
  scheduledTimeEnd?: string;
  durationMinutes?: number;
  address: Record<string, unknown>;
  lineTemplate: Record<string, unknown>[];
  notes?: string;
  preferredPartnerId?: string | null;
  serviceRecipient?: Record<string, unknown>;
  consecutiveUnpaidCount: number;
  pausedAt?: Date;
  pausedReason?: string;
  cancelledAt?: Date;
  endedAt?: Date;
  lastTopUpAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringPlanSchema = new Schema<IRecurringPlan>(
  {
    serviceType: {
      type: String,
      enum: ['book_now', 'post_work'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'paused', 'cancelled', 'ended'],
      default: 'draft',
      index: true,
    },
    customerUid: { type: String, required: true, index: true },
    customerProfileId: { type: Schema.Types.ObjectId, required: true, index: true },
    pattern: {
      type: String,
      enum: ['weekly', 'selected_weekdays', 'biweekly'],
      required: true,
    },
    selectedWeekdays: { type: [Number], default: [] },
    startDate: { type: Date, required: true },
    endDate: Date,
    scheduledTimeStart: { type: String, required: true },
    scheduledTimeEnd: String,
    durationMinutes: Number,
    address: { type: Schema.Types.Mixed, required: true },
    lineTemplate: { type: Schema.Types.Mixed, required: true },
    notes: String,
    preferredPartnerId: { type: String, default: null },
    serviceRecipient: { type: Schema.Types.Mixed, default: undefined },
    consecutiveUnpaidCount: { type: Number, default: 0, min: 0 },
    pausedAt: Date,
    pausedReason: String,
    cancelledAt: Date,
    endedAt: Date,
    lastTopUpAt: Date,
  },
  { timestamps: true },
);

RecurringPlanSchema.index({ serviceType: 1, status: 1, updatedAt: -1 });
RecurringPlanSchema.index({ customerUid: 1, serviceType: 1, status: 1 });

const RecurringPlan: Model<IRecurringPlan> =
  mongoose.models.RecurringPlan || mongoose.model<IRecurringPlan>('RecurringPlan', RecurringPlanSchema);

export default RecurringPlan;
