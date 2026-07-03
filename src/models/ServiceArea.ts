import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IServiceArea extends Document {
  city: string;
  pinCodes: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceAreaSchema = new Schema<IServiceArea>(
  {
    city: { type: String, required: true, trim: true, index: true },
    pinCodes: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const ServiceArea: Model<IServiceArea> =
  mongoose.models.ServiceArea || mongoose.model<IServiceArea>('ServiceArea', ServiceAreaSchema);

export default ServiceArea;
