import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IPostCompareLocationAvailability extends Document {
  areaId: mongoose.Types.ObjectId;
  isEnabled: boolean;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPostCompareLocationAvailability>(
  {
    areaId: { type: Schema.Types.ObjectId, ref: 'LocationArea', required: true },
    isEnabled: { type: Boolean, required: true, default: false },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, collection: 'post_compare_location_availabilities' },
);

schema.index({ areaId: 1 }, { unique: true });

const PostCompareLocationAvailability: Model<IPostCompareLocationAvailability> =
  mongoose.models.PostCompareLocationAvailability ||
  mongoose.model<IPostCompareLocationAvailability>(
    'PostCompareLocationAvailability',
    schema,
  );

export default PostCompareLocationAvailability;
