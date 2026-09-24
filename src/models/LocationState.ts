import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ILocationState extends Document {
  canonicalName: string;
  displayName: string;
  normalizedKey: string;
  countryCode: string;
  code?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ILocationState>({
  canonicalName: { type: String, required: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  normalizedKey: { type: String, required: true, trim: true, unique: true, index: true },
  countryCode: { type: String, required: true, default: 'IN', uppercase: true, trim: true },
  code: { type: String, trim: true, uppercase: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, collection: 'location_states' });

const LocationState: Model<ILocationState> = mongoose.models.LocationState || mongoose.model<ILocationState>('LocationState', schema);
export default LocationState;
