import mongoose, { Schema, Model, Document } from 'mongoose';

export interface ITaskQuestion extends Document {
  taskId: mongoose.Types.ObjectId;
  askedByUid: string;
  question: string;
  answer?: string;
  answeredByUid?: string;
  answeredAt?: Date;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TaskQuestionSchema = new Schema<ITaskQuestion>({
  taskId: {
    type: Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  askedByUid: {
    type: String,
    required: true,
    index: true
  },
  question: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  answer: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  answeredByUid: {
    type: String,
    index: true
  },
  answeredAt: {
    type: Date
  },
  isPublic: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for common queries
TaskQuestionSchema.index({ taskId: 1, createdAt: -1 });
TaskQuestionSchema.index({ askedByUid: 1 });
TaskQuestionSchema.index({ taskId: 1, askedByUid: 1 });

const TaskQuestion: Model<ITaskQuestion> = mongoose.models.TaskQuestion || mongoose.model<ITaskQuestion>('TaskQuestion', TaskQuestionSchema);

export default TaskQuestion;

