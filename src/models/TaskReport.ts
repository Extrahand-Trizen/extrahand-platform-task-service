import mongoose, { Schema, Model, Document } from 'mongoose';

export type ReportReason = 'spam' | 'inappropriate_content' | 'fraudulent' | 'duplicate' | 'wrong_category' | 'other';
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

export interface ITaskReport extends Document {
  userId: string;
  taskId: mongoose.Types.ObjectId;
  reason: ReportReason;
  description?: string;
  status: ReportStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  resolutionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskReportSchema = new Schema<ITaskReport>({
  userId: {
    type: String,
    required: true,
    index: true
  },
  taskId: {
    type: Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  reason: {
    type: String,
    required: true,
    enum: ['spam', 'inappropriate_content', 'fraudulent', 'duplicate', 'wrong_category', 'other'],
    index: true
  },
  description: {
    type: String,
    maxlength: 1000,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
    default: 'pending',
    index: true
  },
  reviewedBy: {
    type: String,
    index: true
  },
  reviewedAt: Date,
  resolutionNotes: String
}, {
  versionKey: false,
  timestamps: true
});

// Compound index to prevent duplicate reports
TaskReportSchema.index({ userId: 1, taskId: 1 });

// Index for finding all reports for a task
TaskReportSchema.index({ taskId: 1, status: 1, createdAt: -1 });

// Index for finding all reports by a user
TaskReportSchema.index({ userId: 1, createdAt: -1 });

const TaskReport: Model<ITaskReport> = mongoose.models.TaskReport || mongoose.model<ITaskReport>('TaskReport', TaskReportSchema);

export default TaskReport;

