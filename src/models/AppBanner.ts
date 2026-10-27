import mongoose, { Document, Model, Schema } from 'mongoose';

export type BannerPlacement = 'book_services' | 'extramart' | 'book_now_scheduled' | 'book_now_instant';
export type BannerActionType = 'screen' | 'category' | 'url' | 'tab' | 'none';
export type BannerTone = 'light' | 'dark';

export interface IAppBanner extends Document {
  placement: BannerPlacement;
  tag?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  actionType: BannerActionType;
  actionValue?: string;
  actionParams?: Record<string, any>;
  backgroundColor?: string;
  tone?: BannerTone;
  ctaLabel?: string;
  sortOrder: number;
  isActive: boolean;
  startDate?: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AppBannerSchema = new Schema<IAppBanner>(
  {
    placement: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: ['book_services', 'extramart', 'book_now_scheduled', 'book_now_instant'],
      index: true,
    },
    tag: { type: String, trim: true },
    eyebrow: { type: String, trim: true },
    title: { type: String, trim: true, default: '' },
    subtitle: { type: String, trim: true },
    imageUrl: { type: String, trim: true, default: '' },
    actionType: {
      type: String,
      required: true,
      enum: ['screen', 'category', 'url', 'tab', 'none'],
      default: 'none',
    },
    actionValue: { type: String, trim: true },
    actionParams: { type: Schema.Types.Mixed, default: {} },
    backgroundColor: { type: String, trim: true, default: '#FFFFFF' },
    tone: { type: String, enum: ['light', 'dark'], default: 'light' },
    ctaLabel: { type: String, trim: true },
    sortOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { timestamps: true }
);

AppBannerSchema.index({ placement: 1, isActive: 1, sortOrder: 1 });

const AppBanner: Model<IAppBanner> =
  mongoose.models.AppBanner ||
  mongoose.model<IAppBanner>('AppBanner', AppBannerSchema);

export default AppBanner;
