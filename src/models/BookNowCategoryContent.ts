import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IBookNowCategoryContent extends Document {
  categorySlug: string;
  title: string;
  subtitle?: string;
  description?: string;
  heroImageUrl?: string;
  iconUrl?: string;
  scope?: {
    includedTitle: string;
    notIncludedTitle: string;
    sections: Array<{
      id: string;
      label: string;
      includedItems: string[];
      notIncludedItems: string[];
    }>;
  };
  faqCategoryKeys: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BookNowCategoryContentSchema = new Schema<IBookNowCategoryContent>(
  {
    categorySlug: { type: String, required: true, trim: true, lowercase: true, index: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    heroImageUrl: { type: String, trim: true, default: '' },
    iconUrl: { type: String, trim: true, default: '' },
    scope: {
      includedTitle: { type: String, trim: true, default: '' },
      notIncludedTitle: { type: String, trim: true, default: '' },
      sections: [
        {
          id: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          includedItems: [{ type: String, trim: true }],
          notIncludedItems: [{ type: String, trim: true }],
        },
      ],
    },
    faqCategoryKeys: [{ type: String, trim: true }],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

BookNowCategoryContentSchema.index({ categorySlug: 1 }, { unique: true });

const BookNowCategoryContent: Model<IBookNowCategoryContent> =
  mongoose.models.BookNowCategoryContent ||
  mongoose.model<IBookNowCategoryContent>('BookNowCategoryContent', BookNowCategoryContentSchema);

export default BookNowCategoryContent;
