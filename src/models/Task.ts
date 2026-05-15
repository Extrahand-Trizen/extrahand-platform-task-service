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
  categorySlug?: string;
  categoryLabel?: string;
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
  dateOption?: "flexible" | "on-date" | "before-date";
  timeSlot?: "morning" | "midday" | "afternoon" | "evening";
  flexibility: "strict" | "flexible" | "anytime";
  timeFlexibilityValue?: "exact" | "1h" | "3h";

  recurring?: {
    enabled: boolean;
    frequency: "daily" | "weekly" | "custom";
    startDate?: Date;
    endDate?: Date;
    requireApproval?: boolean;
    minCommitment?: number;
  };

  schedule?: Array<{
    date: Date;
    status: "open" | "reserved" | "assigned" | "completed" | "cancelled";
    assigneeId?: mongoose.Types.ObjectId | null;
    assigneeUid?: string | null;
  }>;

  requirements?: string[];
  images?: string[];
  tags?: string[];

  views: number;
  isFeatured: boolean;
  expiresAt?: Date;

  completionProof?: Array<{
    url: string;
    filename?: string;
    uploadedAt?: Date;
    uploadedBy?: string;
  }>;
  completionStatus?: "pending_approval" | "approved" | "rejected";
  completionNotes?: string;
  completionRejectedReason?: string;
  completionApprovedAt?: Date;
  completionRejectedAt?: Date;

  feedback?: Array<{
    message: string;
    createdById: mongoose.Types.ObjectId;
    createdAt: Date;
  }>;

  startOtp?: {
    codeHash: string;
    requestedAt: Date;
    expiresAt: Date;
    verifiedAt?: Date;
    attempts: number;
    resendCount: number;
    requestedById: mongoose.Types.ObjectId;
  };

  additionalQuoteRequests?: Array<{
    requestId: string;
    amount: number;
    reason: string;
    proofImages?: string[];
    // TEMP DISABLED: selfie/work-photo specific fields retained only for backward compatibility.
    selfieImage?: string;
    workImage?: string;
    status: "pending" | "accepted" | "rejected" | "withdrawn";
    createdAt: Date;
    decidedAt?: Date;
    decidedById?: mongoose.Types.ObjectId;
    decisionReason?: string;
  }>;
  activeAdditionalQuoteRequestId?: string | null;

  /** Poster changed fixed (non-negotiable) budget from Edit Work — at most one such change server-side. */
  posterBudgetEditedViaFormOnce?: boolean;

  // ── Global Budget Revision (Phase 1) ────────────────────────────────────────
  /** How many times the poster has revised the listed budget. Capped by MAX_REVISION_ROUNDS. Default = 0. */
  currentRevisionRound: number;
  /** High-level negotiation state for the task. Separate from task lifecycle status. */
  negotiationStatus: "open" | "revised" | "closed";
  /** Append-only audit trail of poster listed-budget revisions (negotiable flow). */
  budgetRevisions?: Array<{
    round: number;
    previousAmount: number;
    newAmount: number;
    revisedAt: Date;
    revisedById: mongoose.Types.ObjectId;
    notifiedBidderCount: number;
  }>;

  startedAt?: Date;
  inProgressAt?: Date;
  reviewAt?: Date;
  completionSubmittedAt?: Date;
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
    categorySlug: { type: String, index: true },
    categoryLabel: String,
    subcategory: String,

    budget: {
      amount: { type: Number, required: true, min: 0 },
      currency: { type: String, default: "INR" },
      type: { type: String, enum: ["fixed", "hourly"], default: "fixed" },
    },
    isNegotiable: { type: Boolean, default: false },
    posterBudgetEditedViaFormOnce: { type: Boolean, default: false },

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
    dateOption: {
      type: String,
      enum: ["flexible", "on-date", "before-date"],
    },
    timeSlot: {
      type: String,
      enum: ["morning", "midday", "afternoon", "evening"],
    },
    flexibility: {
      type: String,
      enum: ["strict", "flexible", "anytime"],
      default: "flexible",
    },
    timeFlexibilityValue: {
      type: String,
      enum: ["exact", "1h", "3h"],
    },

    recurring: {
      enabled: { type: Boolean, default: false },
      frequency: {
        type: String,
        enum: ["daily", "weekly", "custom"],
        default: "daily",
      },
      startDate: Date,
      endDate: Date,
      requireApproval: { type: Boolean, default: true },
      minCommitment: Number,
    },

    schedule: {
      type: [
        {
          date: { type: Date, required: true },
          status: {
            type: String,
            enum: ["open", "reserved", "assigned", "completed", "cancelled"],
            default: "open",
          },
          assigneeId: {
            type: Schema.Types.ObjectId,
            ref: "Profile",
            default: null,
          },
          assigneeUid: { type: String, default: null },
        },
      ],
      default: [],
    },

    requirements: [String],
    images: [String],
    tags: [String],

    views: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },

    expiresAt: { type: Date, index: true },

    completionProof: [{
      url: { type: String, required: true },
      filename: String,
      uploadedAt: Date,
      uploadedBy: String,
    }],
    completionStatus: {
      type: String,
      enum: ["pending_approval", "approved", "rejected"],
      index: true,
    },
    completionNotes: String,
    completionRejectedReason: String,
    completionApprovedAt: Date,
    completionRejectedAt: Date,
    feedback: [{
      message: { type: String, required: true },
      createdById: {
        type: Schema.Types.ObjectId,
        ref: "Profile",
        required: true,
      },
      createdAt: { type: Date, default: Date.now },
    }],
    startOtp: {
      codeHash: String,
      requestedAt: Date,
      expiresAt: Date,
      verifiedAt: Date,
      attempts: { type: Number, default: 0 },
      resendCount: { type: Number, default: 0 },
      requestedById: {
        type: Schema.Types.ObjectId,
        ref: "Profile",
      },
    },
    additionalQuoteRequests: [{
      requestId: { type: String, required: true },
      amount: { type: Number, required: true, min: 1 },
      reason: { type: String, required: true, trim: true, maxlength: 1000 },
      proofImages: [{ type: String }],
      // TEMP DISABLED: selfie/work-photo specific required fields.
      // selfieImage: { type: String, required: true },
      // workImage: { type: String, required: true },
      selfieImage: { type: String, required: false },
      workImage: { type: String, required: false },
      status: {
        type: String,
        enum: ["pending", "accepted", "rejected", "withdrawn"],
        default: "pending",
      },
      createdAt: { type: Date, default: Date.now },
      decidedAt: Date,
      decidedById: {
        type: Schema.Types.ObjectId,
        ref: "Profile",
      },
      decisionReason: String,
    }],
    activeAdditionalQuoteRequestId: { type: String, default: null },

    // ── Global Budget Revision (Phase 1) ────────────────────────────────────
    currentRevisionRound: { type: Number, default: 0, min: 0, max: 1 },
    negotiationStatus: {
      type: String,
      enum: ["open", "revised", "closed"],
      default: "open",
      index: true,
    },
    budgetRevisions: {
      type: [
        {
          round: { type: Number, required: true, min: 1 },
          previousAmount: { type: Number, required: true, min: 0 },
          newAmount: { type: Number, required: true, min: 0 },
          revisedAt: { type: Date, default: Date.now },
          revisedById: {
            type: Schema.Types.ObjectId,
            ref: "Profile",
            required: true,
          },
          notifiedBidderCount: { type: Number, default: 0, min: 0 },
        },
      ],
      default: [],
    },

    startedAt: Date,
    inProgressAt: Date,
    reviewAt: Date,
    completionSubmittedAt: Date,
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
TaskSchema.index({ "schedule.date": 1, status: 1 });
// List queries: filter by category+status (or status) then sort by date or price
TaskSchema.index({ category: 1, status: 1, createdAt: -1 });
TaskSchema.index({ category: 1, status: 1, "budget.amount": 1 });
TaskSchema.index({ status: 1, createdAt: -1 });
// Global revision: poster's revisable open tasks
TaskSchema.index({ requesterId: 1, status: 1, currentRevisionRound: 1 }, { name: "requester_status_revision" });

const Task: Model<ITask> =
  mongoose.models.Task || mongoose.model<ITask>("Task", TaskSchema);

export default Task;
