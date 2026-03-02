import mongoose, { Schema, Model, Document } from "mongoose";

export type ReviewType = "poster_to_performer" | "performer_to_poster";

export interface IReview extends Document {
  taskId: mongoose.Types.ObjectId;
  reviewerId: mongoose.Types.ObjectId; // ObjectId reference to Profile
  reviewedId: mongoose.Types.ObjectId; // ObjectId reference to Profile
  reviewType: ReviewType;
  rating: number;
  title?: string;
  comment?: string;
  ratings?: {
    communication?: number;
    quality?: number;
    timeliness?: number;
    professionalism?: number;
    value?: number;
  };
  isPublic: boolean;
  isVerified: boolean;
  helpful: number;
  notHelpful: number;
  helpfulVoters: string[];    // profile ObjectId strings
  notHelpfulVoters: string[]; // profile ObjectId strings
  response?: {
    comment: string;
    timestamp: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    reviewerId: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
      index: true,
    },
    reviewedId: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
      index: true,
    },

    reviewType: {
      type: String,
      enum: ["poster_to_performer", "performer_to_poster"],
      required: true,
      index: true,
    },

    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, maxlength: 100 },
    comment: { type: String, maxlength: 1000 },

    ratings: {
      communication: { type: Number, min: 1, max: 5 },
      quality: { type: Number, min: 1, max: 5 },
      timeliness: { type: Number, min: 1, max: 5 },
      professionalism: { type: Number, min: 1, max: 5 },
      value: { type: Number, min: 1, max: 5 },
    },

    isPublic: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: true }, // auto-set in service
    helpful: { type: Number, default: 0 },
    notHelpful: { type: Number, default: 0 },
    helpfulVoters: { type: [String], default: [] },
    notHelpfulVoters: { type: [String], default: [] },

    response: {
      comment: String,
      timestamp: Date,
    },
  },
  { timestamps: true }
);

// Prevent duplicate reviews per direction
ReviewSchema.index(
  { taskId: 1, reviewerId: 1, reviewType: 1 }, // ✅ Updated from reviewerUid
  { unique: true }
);
// User reviews list: filter by reviewedId, sort by createdAt
ReviewSchema.index({ reviewedId: 1, createdAt: -1 });

const Review: Model<IReview> =
  mongoose.models.Review || mongoose.model<IReview>("Review", ReviewSchema);

export default Review;
