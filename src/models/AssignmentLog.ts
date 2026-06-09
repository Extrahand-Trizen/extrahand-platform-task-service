import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IAssignmentLog extends Document {
  assignmentId: Types.ObjectId;
  action: string;
  actorUid?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AssignmentLogSchema = new Schema<IAssignmentLog>(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
    action: { type: String, required: true },
    actorUid: String,
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const AssignmentLog: Model<IAssignmentLog> =
  mongoose.models.AssignmentLog ||
  mongoose.model<IAssignmentLog>('AssignmentLog', AssignmentLogSchema);

export default AssignmentLog;
