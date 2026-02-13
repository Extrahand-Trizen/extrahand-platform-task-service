import mongoose, { Schema, Model, Document } from "mongoose";
import { ApplicationStatus } from "../types";

export interface ITaskApplication extends Document {
  taskId: mongoose.Types.ObjectId;
  applicantId: mongoose.Types.ObjectId; // ObjectId reference to Profile
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
  coverLetter?: string;
  relevantExperience?: string[];
  portfolio?: string[];
  status: ApplicationStatus;
  messages?: Array<{
    senderId: mongoose.Types.ObjectId; // ObjectId reference to Profile
    message: string;
    timestamp: Date;
    isRead: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
  respondedAt?: Date;
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

    coverLetter: { type: String, maxlength: 1000 },
    relevantExperience: [String],
    portfolio: [String],

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "withdrawn"],
      default: "pending",
      index: true,
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
  },
  { timestamps: true }
);

// Indexes
TaskApplicationSchema.index({ taskId: 1, status: 1 });
TaskApplicationSchema.index({ applicantId: 1, status: 1 }); // ✅ Updated from applicantUid
TaskApplicationSchema.index({ taskId: 1, applicantId: 1 }, { unique: true }); // ✅ Updated from applicantUid

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
