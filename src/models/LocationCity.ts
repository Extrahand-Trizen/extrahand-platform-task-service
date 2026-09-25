import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ILocationCity extends Document {
  stateId: mongoose.Types.ObjectId;
  canonicalName: string;
  displayName: string;
  normalizedKey: string;
  aliases: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ILocationCity>({
  stateId: { type: Schema.Types.ObjectId, ref: 'LocationState', required: true, index: true },
  canonicalName: { type: String, required: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  normalizedKey: { type: String, required: true, trim: true },
  aliases: { type: [String], default: [] },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, collection: 'location_cities' });

schema.index({ stateId: 1, normalizedKey: 1 }, { unique: true });
const LocationCity: Model<ILocationCity> = mongoose.models.LocationCity || mongoose.model<ILocationCity>('LocationCity', schema);
export default LocationCity;
