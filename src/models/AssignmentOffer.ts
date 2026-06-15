import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type AssignmentOfferStatus =
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface IAssignmentOffer extends Document {
  taskId: Types.ObjectId;
  bookingOrderId: string;
  partnerId: Types.ObjectId;
  partnerUid: string;
  status: AssignmentOfferStatus;
  expiresAt: Date;
  respondedAt?: Date;
  assignmentMode: 'broadcast' | 'manual' | 'auto';
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentOfferSchema = new Schema<IAssignmentOffer>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    bookingOrderId: { type: String, required: true, index: true },
    partnerId: { type: Schema.Types.ObjectId, required: true, index: true },
    partnerUid: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['offered', 'accepted', 'declined', 'expired', 'cancelled'],
      default: 'offered',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    respondedAt: Date,
    assignmentMode: {
      type: String,
      enum: ['broadcast', 'manual', 'auto'],
      default: 'broadcast',
    },
  },
  { timestamps: true },
);

AssignmentOfferSchema.index({ taskId: 1, status: 1 });
AssignmentOfferSchema.index({ partnerUid: 1, status: 1 });

const AssignmentOffer: Model<IAssignmentOffer> =
  mongoose.models.AssignmentOffer ||
  mongoose.model<IAssignmentOffer>('AssignmentOffer', AssignmentOfferSchema);

export default AssignmentOffer;
