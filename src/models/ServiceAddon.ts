import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IServiceAddon extends Document {
  skuId: Types.ObjectId;
  slug: string;
  name: string;
  price: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceAddonSchema = new Schema<IServiceAddon>(
  {
    skuId: { type: Schema.Types.ObjectId, ref: 'ServiceSku', required: true, index: true },
    slug: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ServiceAddonSchema.index({ skuId: 1, slug: 1 }, { unique: true });

const ServiceAddon: Model<IServiceAddon> =
  mongoose.models.ServiceAddon || mongoose.model<IServiceAddon>('ServiceAddon', ServiceAddonSchema);

export default ServiceAddon;
