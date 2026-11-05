import mongoose, { Document, Model, Schema } from 'mongoose';
import type { HourlySlotMode } from '../utils/hourlySlotPolicy';
import type { LocationType } from './HourlyHelperLocationAvailability';

export interface IHourlyHelperSlotSettings extends Document {
  locationType: LocationType;
  locationId: string | mongoose.Types.ObjectId;
  mode: HourlySlotMode;
  startTime: string;
  endTime: string;
  blockedHours: number;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IHourlyHelperSlotSettings>(
  {
    locationType: { type: String, enum: ['state', 'city', 'pincode', 'area'], required: true },
    locationId: { type: Schema.Types.Mixed, required: true, index: true },
    mode: { type: String, enum: ['helper_capacity', 'managed_schedule'], required: true },
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    endTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    blockedHours: { type: Number, required: true, min: 0, max: 24 },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'hourly_helper_slot_settings' },
);

schema.index({ locationType: 1, locationId: 1 }, { unique: true });

const HourlyHelperSlotSettings: Model<IHourlyHelperSlotSettings> =
  mongoose.models.HourlyHelperSlotSettings ||
  mongoose.model<IHourlyHelperSlotSettings>('HourlyHelperSlotSettings', schema);

export default HourlyHelperSlotSettings;
