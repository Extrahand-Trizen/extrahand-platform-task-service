import mongoose, { Schema, Model, Document } from 'mongoose';
import { ApplicationStatus } from '../types';

export interface ITaskApplication extends Document {
  taskId: mongoose.Types.ObjectId;
  applicantUid: string;
  proposedBudget: {
    amount: number;
    currency: string;
    isNegotiable: boolean;
  };
  proposedTime?: {
    startDate?: Date;
    endDate?: Date;
    estimatedDuration?: number;
    flexible: boolean;
  };
  coverLetter?: string;
  relevantExperience?: string[];
  portfolio?: string[];
  status: ApplicationStatus;
  messages?: Array<{
    senderUid: string;
    message: string;
    timestamp: Date;
    isRead: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
  respondedAt?: Date;
  isUrgent: boolean;
  priority: 'low' | 'medium' | 'high';
}

const TaskApplicationSchema = new Schema<ITaskApplication>({
  taskId: {
    type: Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  applicantUid: {
    type: String,
    required: true,
    index: true
  },
  proposedBudget: {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    isNegotiable: { type: Boolean, default: true }
  },
  proposedTime: {
    startDate: Date,
    endDate: Date,
    estimatedDuration: Number,
    flexible: { type: Boolean, default: true }
  },
  coverLetter: {
    type: String,
    maxlength: 1000
  },
  relevantExperience: [String],
  portfolio: [String],
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
    default: 'pending',
    index: true
  },
  messages: [{
    senderUid: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: Date,
  isUrgent: {
    type: Boolean,
    default: false
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  }
}, {
  versionKey: false,
  timestamps: true
});

// Compound indexes
TaskApplicationSchema.index({ taskId: 1, status: 1 });
TaskApplicationSchema.index({ applicantUid: 1, status: 1 });
TaskApplicationSchema.index({ taskId: 1, applicantUid: 1 }, { unique: true });
TaskApplicationSchema.index({ createdAt: -1, status: 1 });

// Pre-save middleware
TaskApplicationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (this.isModified('status') && this.status !== 'pending') {
    this.respondedAt = new Date();
  }
  next();
});

const TaskApplication: Model<ITaskApplication> = mongoose.models.TaskApplication || mongoose.model<ITaskApplication>('TaskApplication', TaskApplicationSchema);

export default TaskApplication;

