import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type AssignmentMode = 'manual' | 'broadcast' | 'auto';
export type AssignmentStatus = 'pending' | 'assigned' | 'failed' | 'cancelled';

export interface IAssignment extends Document {
  bookingOrderId: string;
  bookingItemId: Types.ObjectId;
  taskId: Types.ObjectId;
  helperUid?: string;
  helperProfileId?: Types.ObjectId;
  assignmentMode: AssignmentMode;
  status: AssignmentStatus;
  assignedByUid?: string;
  assignedAt?: Date;
  failureReason?: string;
  offerExpiresAt?: Date;
  candidateIds?: string[];
  acceptedBy?: string;
  respondedAt?: Date;
  response?: 'accepted' | 'declined' | 'expired';
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentSchema = new Schema<IAssignment>(
  {
    bookingOrderId: { type: String, required: true, index: true },
    bookingItemId: { type: Schema.Types.ObjectId, ref: 'BookingItem', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    helperUid: { type: String, index: true },
    helperProfileId: { type: Schema.Types.ObjectId },
    assignmentMode: {
      type: String,
      enum: ['manual', 'broadcast', 'auto'],
      default: 'manual',
    },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    assignedByUid: String,
    assignedAt: Date,
    failureReason: String,
    offerExpiresAt: Date,
    candidateIds: [String],
    acceptedBy: String,
    respondedAt: Date,
    response: { type: String, enum: ['accepted', 'declined', 'expired'] },
  },
  { timestamps: true }
);

const Assignment: Model<IAssignment> =
  mongoose.models.Assignment || mongoose.model<IAssignment>('Assignment', AssignmentSchema);

export default Assignment;
