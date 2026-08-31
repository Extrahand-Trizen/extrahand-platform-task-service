import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IServiceQuotationLineItem {
  code?: string;
  title: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitRate?: number;
  amount: number;
  metadata?: Record<string, unknown>;
}

export interface IServiceQuotation extends Document {
  consultationTaskId: Types.ObjectId;
  assessmentId?: Types.ObjectId;
  bookingOrderId?: string;
  bookingItemId?: string;
  projectBookingOrderId?: string;
  projectTaskId?: Types.ObjectId;
  requesterId: Types.ObjectId;
  partnerId?: Types.ObjectId | null;
  partnerUid?: string | null;
  serviceType?: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'superseded';
  version: number;
  currency: 'INR';
  subtotal: number;
  gst: number;
  total: number;
  lineItems: IServiceQuotationLineItem[];
  scopeSummary?: string;
  notes?: string;
  estimatedTimelineDays?: number;
  preferredStartDate?: Date;
  validUntil?: Date;
  sentAt?: Date;
  acceptedAt?: Date;
  projectPaymentStatus?: 'not_initiated' | 'awaiting_payment' | 'paid';
  rejectedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceQuotationSchema = new Schema<IServiceQuotation>(
  {
    consultationTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      index: true,
    },
    assessmentId: {
      type: Schema.Types.ObjectId,
      ref: 'ConsultationAssessment',
      index: true,
    },
    bookingOrderId: { type: String, index: true },
    bookingItemId: String,
    projectBookingOrderId: { type: String, index: true },
    projectTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      index: true,
    },
    requesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
      index: true,
    },
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Profile',
      default: null,
      index: true,
    },
    partnerUid: { type: String, default: null, index: true },
    serviceType: { type: String, trim: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded'],
      default: 'sent',
      index: true,
    },
    version: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },
    subtotal: { type: Number, required: true, min: 0 },
    gst: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    lineItems: {
      type: [
        {
          code: String,
          title: { type: String, required: true },
          description: String,
          quantity: Number,
          unit: String,
          unitRate: Number,
          amount: { type: Number, required: true, min: 0 },
          metadata: { type: Schema.Types.Mixed, default: undefined },
        },
      ],
      required: true,
      default: [],
    },
    scopeSummary: String,
    notes: String,
    estimatedTimelineDays: Number,
    preferredStartDate: Date,
    validUntil: Date,
    sentAt: Date,
    acceptedAt: Date,
    projectPaymentStatus: {
      type: String,
      enum: ['not_initiated', 'awaiting_payment', 'paid'],
      default: 'not_initiated',
      index: true,
    },
    rejectedAt: Date,
    rejectionReason: String,
  },
  { timestamps: true },
);

ServiceQuotationSchema.index(
  { consultationTaskId: 1, version: -1 },
  { unique: true, name: 'quotation_task_version_unique' },
);

ServiceQuotationSchema.index(
  { consultationTaskId: 1, status: 1, createdAt: -1 },
  { name: 'quotation_task_status_created' },
);

ServiceQuotationSchema.index(
  { projectBookingOrderId: 1, projectPaymentStatus: 1 },
  { sparse: true, name: 'quotation_project_booking_payment_status' },
);

const ServiceQuotation: Model<IServiceQuotation> =
  mongoose.models.ServiceQuotation ||
  mongoose.model<IServiceQuotation>('ServiceQuotation', ServiceQuotationSchema);

export default ServiceQuotation;
