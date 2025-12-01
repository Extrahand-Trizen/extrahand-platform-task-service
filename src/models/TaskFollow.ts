import mongoose, { Schema, Model, Document } from 'mongoose';

export interface ITaskFollow extends Document {
  userId: string;
  taskId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskFollowSchema = new Schema<ITaskFollow>({
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
  }
}, {
  versionKey: false,
  timestamps: true
});

// Compound index to prevent duplicate follows
TaskFollowSchema.index({ userId: 1, taskId: 1 }, { unique: true });

// Index for finding all tasks followed by a user
TaskFollowSchema.index({ userId: 1, createdAt: -1 });

// Index for finding all users following a task
TaskFollowSchema.index({ taskId: 1, createdAt: -1 });

const TaskFollow: Model<ITaskFollow> = mongoose.models.TaskFollow || mongoose.model<ITaskFollow>('TaskFollow', TaskFollowSchema);

export default TaskFollow;

