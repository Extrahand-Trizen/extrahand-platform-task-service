import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IServiceVariant extends Document {
  skuId: Types.ObjectId;
  slug: string;
  name: string;
  priceDelta: number;
  durationDeltaMinutes: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceVariantSchema = new Schema<IServiceVariant>(
  {
    skuId: { type: Schema.Types.ObjectId, ref: 'ServiceSku', required: true, index: true },
    slug: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    priceDelta: { type: Number, default: 0 },
    durationDeltaMinutes: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ServiceVariantSchema.index({ skuId: 1, slug: 1 }, { unique: true });

const ServiceVariant: Model<IServiceVariant> =
  mongoose.models.ServiceVariant ||
  mongoose.model<IServiceVariant>('ServiceVariant', ServiceVariantSchema);

export default ServiceVariant;
