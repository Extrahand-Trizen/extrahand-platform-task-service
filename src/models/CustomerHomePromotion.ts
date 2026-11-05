import mongoose, { Document, Model, Schema } from 'mongoose';

export type CustomerHomePromotionActionType =
  | 'route'
  | 'category'
  | 'services_hub'
  | 'url'
  | 'none';

export interface ICustomerHomePromotion extends Document {
  tag: string;
  title: string;
  subtitle: string;
  actionType: CustomerHomePromotionActionType;
  actionValue: string;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerHomePromotionSchema = new Schema<ICustomerHomePromotion>(
  {
    tag: { type: String, required: true, trim: true, maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    subtitle: { type: String, required: true, trim: true, maxlength: 160 },
    actionType: {
      type: String,
      enum: ['route', 'category', 'services_hub', 'url', 'none'],
      required: true,
      default: 'none',
    },
    actionValue: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

CustomerHomePromotionSchema.index({ isActive:  1, sortOrder: 1 });

const CustomerHomePromotion: Model<ICustomerHomePromotion> =
  mongoose.models.CustomerHomePromotion ||
  mongoose.model<ICustomerHomePromotion>('CustomerHomePromotion', CustomerHomePromotionSchema);

export default CustomerHomePromotion;
