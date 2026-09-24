import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ILocationPincodeAreaMap extends Document {
  pincodeId: mongoose.Types.ObjectId;
  areaId: mongoose.Types.ObjectId;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ILocationPincodeAreaMap>({
  pincodeId: { type: Schema.Types.ObjectId, ref: 'LocationPincode', required: true, index: true },
  areaId: { type: Schema.Types.ObjectId, ref: 'LocationArea', required: true, index: true },
  isPrimary: { type: Boolean, default: false },
}, { timestamps: true, collection: 'location_pincode_area_map' });
schema.index({ pincodeId: 1, areaId: 1 }, { unique: true });
const LocationPincodeAreaMap: Model<ILocationPincodeAreaMap> = mongoose.models.LocationPincodeAreaMap || mongoose.model<ILocationPincodeAreaMap>('LocationPincodeAreaMap', schema);
export default LocationPincodeAreaMap;
