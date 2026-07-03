import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IServiceSku extends Document {
  categoryId: Types.ObjectId;
  slug: string;
  name: string;
  description?: string;
  basePrice: number;
  pricingUnit: 'fixed' | 'hourly';
  durationMinutes: number;
  taskCategory: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceSkuSchema = new Schema<IServiceSku>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'ServiceCategory', required: true, index: true },
    slug: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    basePrice: { type: Number, required: true, min: 0 },
    pricingUnit: { type: String, enum: ['fixed', 'hourly'], default: 'fixed' },
    durationMinutes: { type: Number, required: true, min: 15 },
    taskCategory: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

ServiceSkuSchema.index({ categoryId: 1, slug: 1 }, { unique: true });

const ServiceSku: Model<IServiceSku> =
  mongoose.models.ServiceSku || mongoose.model<IServiceSku>('ServiceSku', ServiceSkuSchema);

export default ServiceSku;
