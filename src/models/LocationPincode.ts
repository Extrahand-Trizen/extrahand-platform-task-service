import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ILocationPincode extends Document {
  pincode: string;
  normalizedPincode: string;
  stateId: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ILocationPincode>({
  pincode: { type: String, required: true, trim: true },
  normalizedPincode: { type: String, required: true, trim: true, unique: true, index: true },
  stateId: { type: Schema.Types.ObjectId, ref: 'LocationState', required: true, index: true },
  cityId: { type: Schema.Types.ObjectId, ref: 'LocationCity', required: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, collection: 'location_pincodes' });

const LocationPincode: Model<ILocationPincode> = mongoose.models.LocationPincode || mongoose.model<ILocationPincode>('LocationPincode', schema);
export default LocationPincode;
