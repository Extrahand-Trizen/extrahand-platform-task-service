import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IBookNowSkuFaqItem {
  question: string;
  answer: string;
}

export interface IBookNowSkuContent extends Document {
  categorySlug: string;
  skuSlug: string;
  displayName: string;
  shortDescription?: string;
  longDescription?: string;
  includes: string[];
  excludes: string[];
  imageUrls: string[];
  faqItems: IBookNowSkuFaqItem[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BookNowSkuFaqItemSchema = new Schema<IBookNowSkuFaqItem>(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const BookNowSkuContentSchema = new Schema<IBookNowSkuContent>(
  {
    categorySlug: { type: String, required: true, trim: true, lowercase: true, index: true },
    skuSlug: { type: String, required: true, trim: true, lowercase: true, index: true },
    displayName: { type: String, required: true, trim: true },
    shortDescription: { type: String, trim: true },
    longDescription: { type: String, trim: true },
    includes: [{ type: String, trim: true }],
    excludes: [{ type: String, trim: true }],
    imageUrls: [{ type: String, trim: true }],
    faqItems: { type: [BookNowSkuFaqItemSchema], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

BookNowSkuContentSchema.index({ categorySlug: 1, skuSlug: 1 }, { unique: true });

const BookNowSkuContent: Model<IBookNowSkuContent> =
  mongoose.models.BookNowSkuContent ||
  mongoose.model<IBookNowSkuContent>('BookNowSkuContent', BookNowSkuContentSchema);

export default BookNowSkuContent;
