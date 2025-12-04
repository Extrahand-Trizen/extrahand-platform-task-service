import mongoose, { Schema, Model, Document } from 'mongoose';
import { TaskCategory, TaskStatus, BudgetType, Urgency, Priority, Flexibility, CompletionStatus, Location } from '../types';

export interface ITask extends Document {
  title: string;
  description: string;
  category: TaskCategory;
  subcategory?: string;
  budget: number;
  budgetType: BudgetType;
  location?: Location;
  urgency: Urgency;
  status: TaskStatus;
  priority: Priority;
  requesterId: string;
  requesterName: string;
  assignedTo?: string;
  assigneeUid?: string;
  assignedToName?: string;
  assignedAt?: Date;
  estimatedDuration?: number;
  actualDuration?: number;
  scheduledDate?: Date;
  scheduledTime?: string; // Keep for backward compatibility
  scheduledTimeStart?: string; // New: Start time "HH:MM AM/PM" (e.g., "10:00 AM")
  scheduledTimeEnd?: string; // New: End time "HH:MM AM/PM" (e.g., "11:00 AM")
  flexibility: Flexibility;
  requirements?: string[];
  attachments?: Array<{
    type: string;
    url: string;
    filename: string;
    uploadedAt: Date;
  }>;
  images?: string[];
  tags?: string[];
  isUrgent: boolean;
  isFeatured: boolean;
  views: number;
  applications: number;
  rating: number;
  review?: string;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  cancelledBy?: string; // UID of user who cancelled (poster or performer)
  expiresAt?: Date;
  completionProof?: Array<{
    url: string;
    filename: string;
    uploadedAt: Date;
    uploadedBy: string;
  }>;
  completionStatus?: CompletionStatus;
  completionNotes?: string;
  completionRejectedReason?: string;
  completionApprovedAt?: Date;
  completionRejectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  category: {
    type: String,
    required: true,
    enum: ['cleaning', 'repair', 'delivery', 'assembly', 'gardening', 'petcare', 'other'],
    index: true
  },
  subcategory: {
    type: String,
    trim: true
  },
  budget: {
    type: Number,
    required: true,
    min: 0,
    index: true
  },
  budgetType: {
    type: String,
    enum: ['fixed', 'hourly', 'negotiable'],
    default: 'fixed'
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: false // Made optional
    },
    address: {
      type: String,
      required: false // Made optional
    },
    city: {
      type: String,
      required: false, // Made optional
      index: true
    },
    state: {
      type: String,
      required: false // Made optional
    },
    pinCode: String,
    country: {
      type: String,
      default: 'India'
    }
  },
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
    index: true
  },
  status: {
    type: String,
    enum: ['open', 'assigned', 'started', 'in_progress', 'review', 'completed', 'cancelled'],
    default: 'open',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high'],
    default: 'normal'
  },
  requesterId: {
    type: String,
    required: true,
    index: true
  },
  requesterName: {
    type: String,
    required: true
  },
  assignedTo: {
    type: String,
    index: true
  },
  assigneeUid: {
    type: String,
    index: true
  },
  assignedToName: String,
  assignedAt: Date,
  estimatedDuration: {
    type: Number,
    min: 0.5,
    max: 168
  },
  actualDuration: {
    type: Number,
    min: 0
  },
  scheduledDate: Date,
  scheduledTime: String, // Keep for backward compatibility
  scheduledTimeStart: {
    type: String,
    // Format: "HH:MM AM/PM" (e.g., "10:00 AM", "02:30 PM")
  },
  scheduledTimeEnd: {
    type: String,
    // Format: "HH:MM AM/PM" (e.g., "11:00 AM", "03:30 PM")
  },
  flexibility: {
    type: String,
    enum: ['strict', 'flexible', 'anytime'],
    default: 'flexible'
  },
  requirements: [String],
  attachments: [{
    type: String,
    url: String,
    filename: String,
    uploadedAt: Date
  }],
  images: [String],
  tags: [String],
  isUrgent: {
    type: Boolean,
    default: false,
    index: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  views: {
    type: Number,
    default: 0
  },
  applications: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  review: String,
  completedAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  cancelledBy: String, // UID of user who cancelled (poster or performer)
  expiresAt: {
    type: Date,
    index: true
  },
  completionProof: [{
    url: String,
    filename: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: String
  }],
  completionStatus: {
    type: String,
    enum: ['pending_approval', 'approved', 'rejected'],
    index: true
  },
  completionNotes: String,
  completionRejectedReason: String,
  completionApprovedAt: Date,
  completionRejectedAt: Date
}, {
  timestamps: true
});

// Indexes for common queries
TaskSchema.index({ 'location.coordinates': '2dsphere' });
TaskSchema.index({ category: 1, status: 1 });
TaskSchema.index({ budget: 1, status: 1 });
TaskSchema.index({ urgency: 1, status: 1 });
TaskSchema.index({ createdAt: -1 });
TaskSchema.index({ expiresAt: 1, status: 1 });
TaskSchema.index({ completionStatus: 1, status: 1 });
TaskSchema.index({ requesterId: 1, status: 1 });
TaskSchema.index({ assigneeUid: 1, status: 1 });

const Task: Model<ITask> = mongoose.models.Task || mongoose.model<ITask>('Task', TaskSchema);

export default Task;

