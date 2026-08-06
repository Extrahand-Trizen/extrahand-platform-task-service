import mongoose, { Document, Model, Schema } from 'mongoose';
import type { HelpSupportVariant } from '../constants/helpSupportSeedData';

export interface IHelpSupportFaqItem {
  q: string;
  a: string;
}

export interface IHelpSupportContent extends Document {
  variant: HelpSupportVariant;
  categoryKey: string;
  title: string;
  subtitle: string;
  icon: string;
  items: IHelpSupportFaqItem[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HelpSupportFaqItemSchema = new Schema<IHelpSupportFaqItem>(
  {
    q: { type: String, required: true, trim: true },
    a: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const HelpSupportContentSchema = new Schema<IHelpSupportContent>(
  {
    variant: {
      type: String,
      required: true,
      enum: ['customer', 'helper'],
      index: true,
    },
    categoryKey: { type: String, required: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, required: true, trim: true },
    icon: { type: String, required: true, trim: true },
    items: { type: [HelpSupportFaqItemSchema], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

HelpSupportContentSchema.index({ variant: 1, categoryKey: 1 }, { unique: true });

const HelpSupportContent: Model<IHelpSupportContent> =
  mongoose.models.HelpSupportContent ||
  mongoose.model<IHelpSupportContent>('HelpSupportContent', HelpSupportContentSchema);

export default HelpSupportContent;
