import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IServiceCategory extends Document {
  slug: string;
  name: string;
  description?: string;
  iconUrl?: string;
  capabilityType?: 'field_service' | 'delivery' | 'driver' | 'mover' | 'remote_service';
  executionProfile?: 'field_service' | 'delivery' | 'driver' | 'mover' | 'remote_service';
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceCategorySchema = new Schema<IServiceCategory>(
  {
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    iconUrl: { type: String, trim: true },
    capabilityType: {
      type: String,
      enum: ['field_service', 'delivery', 'driver', 'mover', 'remote_service'],
      default: 'field_service',
    },
    executionProfile: {
      type: String,
      enum: ['field_service', 'delivery', 'driver', 'mover', 'remote_service'],
      default: 'field_service',
    },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const ServiceCategory: Model<IServiceCategory> =
  mongoose.models.ServiceCategory ||
  mongoose.model<IServiceCategory>('ServiceCategory', ServiceCategorySchema);

export default ServiceCategory;
