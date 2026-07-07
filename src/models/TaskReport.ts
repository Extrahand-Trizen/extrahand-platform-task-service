import mongoose, { Schema, Model, Document } from "mongoose";

export interface ITaskReport extends Document {
  userId: mongoose.Types.ObjectId; // ObjectId reference to Profile
  taskId: mongoose.Types.ObjectId;
  reason: string;
  description?: string;
  status: string;
  reviewedById?: mongoose.Types.ObjectId; // ObjectId reference to Profile
  reviewedAt?: Date;
  resolutionNotes?: string;
  taskSnapshot: {
    title: string;
    description: string;
    category: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Export ReportReason type for use in services
export type ReportReason = 'spam' | 'inappropriate_content' | 'fraudulent' | 'duplicate' | 'wrong_category' | 'other';

const TaskReportSchema = new Schema<ITaskReport>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
      index: true,
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },

    reason: {
      type: String,
      enum: [
        "spam",
        "inappropriate_content",
        "fraudulent",
        "duplicate",
        "wrong_category",
        "other",
      ],
      required: true,
      index: true,
    },

    description: { type: String, maxlength: 1000, trim: true },

    status: {
      type: String,
      enum: ["pending", "reviewed", "resolved", "dismissed"],
      default: "pending",
      index: true,
    },

    reviewedById: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      index: true,
    },
    reviewedAt: Date,
    resolutionNotes: String,

    taskSnapshot: {
      title: { type: String, required: true },
      description: { type: String, required: true },
      category: { type: String, required: true },
    },
  },
  { timestamps: true }
);

// 🔒 Prevent duplicate reports
TaskReportSchema.index({ userId: 1, taskId: 1 }, { unique: true });

const TaskReport: Model<ITaskReport> =
  mongoose.models.TaskReport ||
  mongoose.model<ITaskReport>("TaskReport", TaskReportSchema);

export default TaskReport;
