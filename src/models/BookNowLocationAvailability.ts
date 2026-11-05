import mongoose, { Document, Model, Schema } from 'mongoose';

export type BookNowLocationType = 'state' | 'city' | 'pincode' | 'area';

export interface IBookNowLocationAvailability extends Document {
  locationType: BookNowLocationType;
  locationId: mongoose.Types.ObjectId;
  isEnabled: boolean;
  isHidden?: boolean;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IBookNowLocationAvailability>(
  {
    locationType: { type: String, enum: ['state', 'city', 'pincode', 'area'], required: true },
    locationId: { type: Schema.Types.ObjectId, required: true },
    isEnabled: { type: Boolean, required: true },
    isHidden: { type: Boolean, default: false },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'book_now_location_availabilities' },
);

schema.index({ locationType: 1, locationId: 1 }, { unique: true });

const BookNowLocationAvailability: Model<IBookNowLocationAvailability> =
  mongoose.models.BookNowLocationAvailability ||
  mongoose.model<IBookNowLocationAvailability>('BookNowLocationAvailability', schema);

export default BookNowLocationAvailability;
