import mongoose, { Schema, Model, Document } from "mongoose";
import { ApplicationStatus, ApplicationNegotiationStatus } from "../types";

export interface ITaskApplication extends Document {
  taskId: mongoose.Types.ObjectId;
  applicantId: mongoose.Types.ObjectId; // ObjectId reference to Profile
  applicantUid: string; // Firebase UID for the applicant
  applicantProfile?: {
    name: string;
    photoURL?: string;
    rating?: number;
    totalReviews?: number;
    skills?: {
      list: string[];
    };
  };
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
  selectedDates?: Date[];
  coverLetter?: string;
  relevantExperience?: string[];
  portfolio?: string[];
  status: ApplicationStatus;
  negotiation?: {
    initialAmount: number;
    currentAmount: number;
    finalAmount?: number;
    status: ApplicationNegotiationStatus;
    lastActionBy?: "poster" | "tasker";
    history: Array<{
      amount: number;
      action: "counter" | "accept" | "reject";
      by: "poster" | "tasker";
      at: Date;
    }>;
  };
  messages?: Array<{
    senderId: mongoose.Types.ObjectId; // ObjectId reference to Profile
    message: string;
    timestamp: Date;
    isRead: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
  respondedAt?: Date;
  /**
   * Number of times this withdrawn application was re-submitted by the same applicant.
   * Business rule: allow only one re-offer after withdrawal.
   */
  reofferCount?: number;

  // ── Global Budget Revision (Phase 1) ────────────────────────────────────────
  /**
   * Denormalized copy of task.currentRevisionRound at the time of the last
   * poster revision. Updated by the revise-budget API via updateMany.
   * Used to check if this tasker has already responded to the current round
   * without needing to fetch the task document.
   */
  taskCurrentRevisionRound?: number;
  /**
   * The revision round number this tasker last responded to (keep/revise).
   * 0 = never responded to any round.
   * Guard: respondedToRevisionRound >= taskCurrentRevisionRound → already responded.
   */
  respondedToRevisionRound: number;
  /**
   * For fixed-budget (non-negotiable) listings: set after the tasker changes their
   * offered price once via PATCH application — blocks further amount edits.
   */
  freeOfferEditUsed?: boolean;
  /** Append-only log of the tasker's responses to global revision rounds. */
  quotationRevisions?: Array<{
    round: number;
    previousAmount: number;
    newAmount: number;
    revisedAt: Date;
    action: "revised" | "kept" | "withdrawn";
  }>;
}

const TaskApplicationSchema = new Schema<ITaskApplication>(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    applicantId: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
      index: true,
    },
    applicantUid: {
      type: String,
      required: true,
      index: true,
    },

    applicantProfile: {
      name: { type: String, required: false },
      photoURL: { type: String, required: false },
      rating: { type: Number, required: false },
      totalReviews: { type: Number, required: false },
      skills: {
        list: { type: [String], required: false },
      },
    },

    proposedBudget: {
      amount: { type: Number, required: true, min: 0 },
      currency: { type: String, default: "INR" },
      isNegotiable: { type: Boolean, default: true },
    },

    proposedTime: {
      startDate: Date,
      endDate: Date,
      estimatedDuration: Number,
      flexible: { type: Boolean, default: true },
    },

    selectedDates: {
      type: [Date],
      default: [],
    },

    coverLetter: { type: String, maxlength: 1000 },
    relevantExperience: [String],
    portfolio: [String],

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "withdrawn"],
      default: "pending",
      index: true,
    },
    reofferCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    negotiation: {
      initialAmount: { type: Number, min: 0 },
      currentAmount: { type: Number, min: 0 },
      finalAmount: { type: Number, min: 0, required: false },
      status: {
        type: String,
        enum: ["none", "countered_by_poster", "countered_by_tasker", "accepted", "rejected"],
        default: "none",
      },
      lastActionBy: {
        type: String,
        enum: ["poster", "tasker"],
        required: false,
      },
      history: {
        type: [
          {
            amount: { type: Number, required: true, min: 0 },
            action: {
              type: String,
              enum: ["counter", "accept", "reject"],
              required: true,
            },
            by: {
              type: String,
              enum: ["poster", "tasker"],
              required: true,
            },
            at: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
    },

    messages: {
      type: [
        {
          senderId: {
            type: Schema.Types.ObjectId,
            ref: "Profile",
            required: true,
          },
          message: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
          isRead: { type: Boolean, default: false },
        },
      ],
      default: [],
      maxlength: 50, // prevents document bloat
    },

    // ── Global Budget Revision (Phase 1) ─────────────────────────────────────
    taskCurrentRevisionRound: { type: Number, default: 0, min: 0 },
    respondedToRevisionRound: { type: Number, default: 0, min: 0 },
    freeOfferEditUsed: { type: Boolean, default: false },
    quotationRevisions: {
      type: [
        {
          round: { type: Number, required: true, min: 1 },
          previousAmount: { type: Number, required: true, min: 0 },
          newAmount: { type: Number, required: true, min: 0 },
          revisedAt: { type: Date, default: Date.now },
          action: {
            type: String,
            enum: ["revised", "kept", "withdrawn"],
            required: true,
          },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Indexes
TaskApplicationSchema.index({ taskId: 1, status: 1 });
TaskApplicationSchema.index({ applicantId: 1, status: 1 });
TaskApplicationSchema.index({ taskId: 1, applicantUid: 1 }, { unique: true }); // Prevent duplicate applications
TaskApplicationSchema.index({ taskId: 1, selectedDates: 1 });
// Covered index: fetch pending bidder UIDs without touching document pages (used in revise-budget notification dispatch)
TaskApplicationSchema.index(
  { taskId: 1, status: 1, applicantUid: 1 },
  { name: "task_status_uid_covered" }
);
// Revision round response tracking: find pending apps that haven't responded to current round
TaskApplicationSchema.index(
  { taskId: 1, status: 1, respondedToRevisionRound: 1 },
  { name: "task_status_revision_round" }
);

// Auto-set respondedAt
TaskApplicationSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status !== "pending") {
    this.respondedAt = new Date();
  }
  next();
});

const TaskApplication: Model<ITaskApplication> =
  mongoose.models.TaskApplication ||
  mongoose.model<ITaskApplication>("TaskApplication", TaskApplicationSchema);

export default TaskApplication;
