import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IBookNowHubServiceItem {
  serviceId: string;
  label: string;
  categorySlug: string;
  sectionId?: string;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
} 

export interface IBookNowHubSection extends Document {
  slug: string;
  title: string;
  iconKey?: string;
  sortOrder: number;
  services: IBookNowHubServiceItem[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BookNowHubServiceItemSchema = new Schema<IBookNowHubServiceItem>(
  {
    serviceId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    categorySlug: { type: String, required: true, trim: true, lowercase: true },
    sectionId: { type: String, trim: true, default: '' },
    imageUrl: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const BookNowHubSectionSchema = new Schema<IBookNowHubSection>(
  {
    slug: { type: String, required: true, trim: true, lowercase: true, index: true },
    title: { type: String, required: true, trim: true },
    iconKey: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0 },
    services: { type: [BookNowHubServiceItemSchema], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

BookNowHubSectionSchema.index({ slug: 1 }, { unique: true });

const BookNowHubSection: Model<IBookNowHubSection> =
  mongoose.models.BookNowHubSection ||
  mongoose.model<IBookNowHubSection>('BookNowHubSection', BookNowHubSectionSchema);

export default BookNowHubSection;
