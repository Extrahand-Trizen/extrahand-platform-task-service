import mongoose, { Document, Model, Schema } from 'mongoose';
import type { BookNowLocationType } from './BookNowLocationAvailability';

export interface IBookNowServiceLocationAvailability extends Document {
  locationType: BookNowLocationType;
  locationId: mongoose.Types.ObjectId;
  catalogId: string;
  isEnabled: boolean;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IBookNowServiceLocationAvailability>(
  {
    locationType: { type: String, enum: ['state', 'city', 'pincode', 'area'], required: true },
    locationId: { type: Schema.Types.ObjectId, required: true },
    catalogId: { type: String, required: true, trim: true },
    isEnabled: { type: Boolean, required: true },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'book_now_service_location_availabilities' },
);

schema.index(
  { locationType: 1, locationId: 1, catalogId: 1 },
  { unique: true },
);

const BookNowServiceLocationAvailability: Model<IBookNowServiceLocationAvailability> =
  mongoose.models.BookNowServiceLocationAvailability ||
  mongoose.model<IBookNowServiceLocationAvailability>(
    'BookNowServiceLocationAvailability',
    schema,
  );

export default BookNowServiceLocationAvailability;
