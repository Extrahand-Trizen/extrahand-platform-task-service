import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ILocationCityPincodeMap extends Document {
  cityId: mongoose.Types.ObjectId;
  pincodeId: mongoose.Types.ObjectId;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ILocationCityPincodeMap>({
  cityId: { type: Schema.Types.ObjectId, ref: 'LocationCity', required: true, index: true },
  pincodeId: { type: Schema.Types.ObjectId, ref: 'LocationPincode', required: true, index: true },
  isPrimary: { type: Boolean, default: false },
}, { timestamps: true, collection: 'location_city_pincode_map' });
schema.index({ cityId: 1, pincodeId: 1 }, { unique: true });
const LocationCityPincodeMap: Model<ILocationCityPincodeMap> = mongoose.models.LocationCityPincodeMap || mongoose.model<ILocationCityPincodeMap>('LocationCityPincodeMap', schema);
export default LocationCityPincodeMap;
