import mongoose, { Schema, Model, Document } from "mongoose";

export interface ITask extends Document {
  title: string;
  description: string;

  category:
    | "cleaning"
    | "repair"
    | "delivery"
    | "assembly"
    | "gardening"
    | "petcare"
    | "other";
  subcategory?: string;

  budget: {
    amount: number;
    currency: "INR";
    type: "fixed" | "hourly";
  };
  isNegotiable: boolean;

  location?: {
    type: "Point";
    coordinates?: [number, number];
    address?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    country?: string;
  };

  urgency: "low" | "medium" | "high" | "urgent";
  priority: "low" | "normal" | "high";

  status:
    | "open"
    | "assigned"
    | "started"
    | "in_progress"
    | "review"
    | "completed"
    | "cancelled";

  requesterId: mongoose.Types.ObjectId; // ObjectId reference to Profile
  // ❌ Removed requesterName - API Gateway will enrich with Profile data

  assigneeId?: mongoose.Types.ObjectId | null; // ObjectId reference to Profile
  assignedAt?: Date;

  estimatedDuration?: number;
  actualDuration?: number;

  scheduledDate?: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  flexibility: "strict" | "flexible" | "anytime";
  timeFlexibilityValue?: "exact" | "1h" | "3h";

  requirements?: string[];
  images?: string[];
  tags?: string[];

  views: number;
  isFeatured: boolean;
  expiresAt?: Date;

  completionStatus?: "pending_approval" | "approved" | "rejected";
  completionNotes?: string;
  completionRejectedReason?: string;
  completionApprovedAt?: Date;
  completionRejectedAt?: Date;

  completedAt?: Date;
  cancelledAt?: Date;
  cancelledById?: mongoose.Types.ObjectId; // ObjectId reference to Profile
  cancellationReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },

    category: {
      type: String,
      enum: [
        "cleaning",
        "repair",
        "delivery",
        "assembly",
        "gardening",
        "petcare",
        "other",
      ],
      required: true,
      index: true,
    },
    subcategory: String,

    budget: {
      amount: { type: Number, required: true, min: 0 },
      currency: { type: String, default: "INR" },
      type: { type: String, enum: ["fixed", "hourly"], default: "fixed" },
    },
    isNegotiable: { type: Boolean, default: false },

    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: [Number],
      address: String,
      city: { type: String, index: true },
      state: String,
      pinCode: String,
      country: { type: String, default: "India" },
    },

    urgency: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },

    status: {
      type: String,
      enum: [
        "open",
        "assigned",
        "started",
        "in_progress",
        "review",
        "completed",
        "cancelled",
      ],
      default: "open",
      index: true,
    },

    requesterId: {
      type: Schema.Types.ObjectId,
      ref: "Profile", // Reference for documentation only - populate won't work across services
      required: true,
      index: true,
    },
    // ❌ Removed requesterName - API Gateway will enrich with Profile data

    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      index: true,
      default: null,
    },
    assignedAt: Date,

    estimatedDuration: Number,
    actualDuration: Number,

    scheduledDate: Date,
    scheduledTimeStart: String,
    scheduledTimeEnd: String,
    flexibility: {
      type: String,
      enum: ["strict", "flexible", "anytime"],
      default: "flexible",
    },
    timeFlexibilityValue: {
      type: String,
      enum: ["exact", "1h", "3h"],
    },

    requirements: [String],
    images: [String],
    tags: [String],

    views: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },

    expiresAt: { type: Date, index: true },

    completionStatus: {
      type: String,
      enum: ["pending_approval", "approved", "rejected"],
      index: true,
    },
    completionNotes: String,
    completionRejectedReason: String,
    completionApprovedAt: Date,
    completionRejectedAt: Date,

    completedAt: Date,
    cancelledAt: Date,
    cancelledById: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      index: true,
    },
    cancellationReason: String,
  },
  { timestamps: true }
);

// Indexes
TaskSchema.index({ "location.coordinates": "2dsphere" });
TaskSchema.index({ category: 1, status: 1 });
TaskSchema.index({ requesterId: 1, status: 1 });
TaskSchema.index({ assigneeId: 1, status: 1 }); // ✅ Updated from assigneeUid
TaskSchema.index({ expiresAt: 1, status: 1 });

const Task: Model<ITask> =
  mongoose.models.Task || mongoose.model<ITask>("Task", TaskSchema);

export default Task;
