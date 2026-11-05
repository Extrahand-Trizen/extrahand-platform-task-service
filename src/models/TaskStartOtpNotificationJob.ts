import mongoose, { Document, Schema } from 'mongoose';

export type OtpNotificationChannelStatus =
  | 'pending'
  | 'processing'
  | 'delivered'
  | 'failed'
  | 'unknown';

export interface ITaskStartOtpNotificationJob extends Document {
  jobKey: string;
  taskId: string;
  requesterUid: string;
  requesterEmail?: string;
  requesterPhone?: string;
  requesterName: string;
  taskerName: string;
  taskTitle: string;
  otp: string;
  notificationData: Record<string, unknown>;
  journeyTitle: string;
  journeyBody: string;
  channels: Record<string, { status: OtpNotificationChannelStatus; messageId?: string }>;
  status: 'pending' | 'processing' | 'retry' | 'completed' | 'dead';
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskStartOtpNotificationJobSchema = new Schema<ITaskStartOtpNotificationJob>(
  {
    jobKey: { type: String, required: true, unique: true },
    taskId: { type: String, required: true, index: true },
    requesterUid: { type: String, required: true },
    requesterEmail: String,
    requesterPhone: String,
    requesterName: { type: String, required: true },
    taskerName: { type: String, required: true },
    taskTitle: { type: String, required: true },
    otp: { type: String, required: true },
    notificationData: { type: Schema.Types.Mixed, required: true },
    journeyTitle: { type: String, required: true },
    journeyBody: { type: String, required: true },
    channels: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'retry', 'completed', 'dead'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, required: true, index: true },
    leaseUntil: Date,
    lastError: String,
  },
  { timestamps: true, collection: 'task_start_otp_notification_jobs' },
);

TaskStartOtpNotificationJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export default (mongoose.models.TaskStartOtpNotificationJob as mongoose.Model<ITaskStartOtpNotificationJob>) ||
  mongoose.model<ITaskStartOtpNotificationJob>(
    'TaskStartOtpNotificationJob',
    TaskStartOtpNotificationJobSchema,
  );
