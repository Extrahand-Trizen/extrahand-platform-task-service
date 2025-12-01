import mongoose, { Schema, Model, Document } from 'mongoose';
import { ReviewRatings } from '../types';

export interface IReview extends Document {
  taskId: mongoose.Types.ObjectId;
  reviewerUid: string;
  reviewedUid: string;
  rating: number;
  title?: string;
  comment?: string;
  ratings?: ReviewRatings;
  isPublic: boolean;
  isVerified: boolean;
  helpful: number;
  notHelpful: number;
  response?: {
    comment: string;
    timestamp: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>({
  taskId: {
    type: Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  reviewerUid: {
    type: String,
    required: true,
    index: true
  },
  reviewedUid: {
    type: String,
    required: true,
    index: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    maxlength: 100
  },
  comment: {
    type: String,
    maxlength: 1000
  },
  ratings: {
    communication: { type: Number, min: 1, max: 5 },
    quality: { type: Number, min: 1, max: 5 },
    timeliness: { type: Number, min: 1, max: 5 },
    professionalism: { type: Number, min: 1, max: 5 },
    value: { type: Number, min: 1, max: 5 }
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  helpful: {
    type: Number,
    default: 0
  },
  notHelpful: {
    type: Number,
    default: 0
  },
  response: {
    comment: String,
    timestamp: Date
  }
}, {
  versionKey: false,
  timestamps: true
});

// Compound indexes
ReviewSchema.index({ taskId: 1, reviewerUid: 1 }, { unique: true });
ReviewSchema.index({ reviewedUid: 1, createdAt: -1 });
ReviewSchema.index({ rating: 1, createdAt: -1 });
ReviewSchema.index({ isPublic: 1, isVerified: 1 });

// Pre-save middleware
ReviewSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Review: Model<IReview> = mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);

export default Review;

