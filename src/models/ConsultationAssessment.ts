import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IConsultationAssessment extends Document {
  consultationTaskId: Types.ObjectId;
  bookingOrderId?: string;
  bookingItemId?: string;
  serviceType?: string;
  requesterId: Types.ObjectId;
  partnerId?: Types.ObjectId | null;
  partnerUid?: string | null;
  status: 'draft' | 'submitted';
  siteVisitCompletedAt?: Date;
  notes?: string;
  findings?: string[];
  mediaUrls?: string[];
  measurements?: Record<string, unknown>;
  estimateAdjustment?: {
    previousEstimate?: number;
    revisedEstimate?: number;
    currency?: string;
  };
  recommendedLineItems?: Array<{
    code?: string;
    title: string;
    description?: string;
    quantity?: number;
    unit?: string;
    unitRate?: number;
    amount?: number;
    metadata?: Record<string, unknown>;
  }>;
  recommendedScope?: string;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConsultationAssessmentSchema = new Schema<IConsultationAssessment>(
  {
    consultationTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      index: true,
    },
    bookingOrderId: { type: String, index: true },
    bookingItemId: String,
    serviceType: { type: String, trim: true, index: true },
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
    status: {
      type: String,
      enum: ['draft', 'submitted'],
      default: 'submitted',
      index: true,
    },
    siteVisitCompletedAt: Date,
    notes: String,
    findings: { type: [String], default: undefined },
    mediaUrls: { type: [String], default: undefined },
    measurements: { type: Schema.Types.Mixed, default: undefined },
    estimateAdjustment: {
      previousEstimate: Number,
      revisedEstimate: Number,
      currency: String,
    },
    recommendedLineItems: {
      type: [
        {
          code: String,
          title: { type: String, required: true },
          description: String,
          quantity: Number,
          unit: String,
          unitRate: Number,
          amount: Number,
          metadata: { type: Schema.Types.Mixed, default: undefined },
        },
      ],
      default: undefined,
    },
    recommendedScope: String,
    submittedAt: Date,
  },
  { timestamps: true },
);

ConsultationAssessmentSchema.index(
  { consultationTaskId: 1, createdAt: -1 },
  { name: 'consultation_assessment_task_created' },
);

const ConsultationAssessment: Model<IConsultationAssessment> =
  mongoose.models.ConsultationAssessment ||
  mongoose.model<IConsultationAssessment>(
    'ConsultationAssessment',
    ConsultationAssessmentSchema,
  );

export default ConsultationAssessment;
