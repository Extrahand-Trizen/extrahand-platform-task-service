import mongoose, { Document, Model, Schema } from 'mongoose';

export type LocationType = 'state' | 'city' | 'pincode' | 'area';

export interface IHourlyHelperLocationAvailability extends Document {
  locationType: LocationType;
  locationId: string | mongoose.Types.ObjectId;
  isEnabled: boolean;
  updatedBy?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IHourlyHelperLocationAvailability>(
  {
    locationType: { type: String, enum: ['state', 'city', 'pincode', 'area'], required: true },
    locationId: { type: Schema.Types.Mixed, required: true, index: true },
    isEnabled: { type: Boolean, required: true, default: true, index: true },
    updatedBy: { type: String },
    notes: { type: String },
  },
  { timestamps: true, collection: 'hourly_helper_location_availabilities' }
);

schema.index({ locationType: 1, locationId: 1 }, { unique: true });

const HourlyHelperLocationAvailability: Model<IHourlyHelperLocationAvailability> =
  mongoose.models.HourlyHelperLocationAvailability ||
  mongoose.model<IHourlyHelperLocationAvailability>('HourlyHelperLocationAvailability', schema);

export default HourlyHelperLocationAvailability;
