import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ILocationArea extends Document {
  canonicalName: string;
  displayName: string;
  normalizedKey: string;
  aliases: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ILocationArea>({
  canonicalName: { type: String, required: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  normalizedKey: { type: String, required: true, trim: true },
  aliases: { type: [String], default: [] },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, collection: 'location_areas' });

schema.index({ normalizedKey: 1 }, { unique: true });
const LocationArea: Model<ILocationArea> = mongoose.models.LocationArea || mongoose.model<ILocationArea>('LocationArea', schema);
export default LocationArea;
