import mongoose, { Schema, Model, Document } from 'mongoose';

export interface ITaskQuestion extends Document {
  taskId: mongoose.Types.ObjectId;
  askedById: mongoose.Types.ObjectId; // ObjectId reference to Profile
  question: string;
  answer?: string;
  answeredById?: mongoose.Types.ObjectId; // ObjectId reference to Profile
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
  askedById: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
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
  answeredById: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
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
TaskQuestionSchema.index({ askedById: 1 }); // ✅ Updated from askedByUid
TaskQuestionSchema.index({ taskId: 1, askedById: 1 }); // ✅ Updated from askedByUid

const TaskQuestion: Model<ITaskQuestion> = mongoose.models.TaskQuestion || mongoose.model<ITaskQuestion>('TaskQuestion', TaskQuestionSchema);

export default TaskQuestion;

