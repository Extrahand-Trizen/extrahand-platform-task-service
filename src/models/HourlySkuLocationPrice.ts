import mongoose, { Document, Model, Schema } from 'mongoose';

export type HourlyLocationType = 'area' | 'pincode' | 'city';

export interface IHourlySkuLocationPrice extends Document {
  skuId: mongoose.Types.ObjectId;
  locationType: HourlyLocationType;
  locationId: mongoose.Types.ObjectId;
  offerPrice: number;
  isActive: boolean;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IHourlySkuLocationPrice>({
  skuId: { type: Schema.Types.ObjectId, ref: 'ServiceSku', required: true, index: true },
  locationType: { type: String, enum: ['area', 'pincode', 'city'], required: true },
  locationId: { type: Schema.Types.ObjectId, required: true, index: true },
  offerPrice: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true, index: true },
  effectiveFrom: Date,
  effectiveTo: Date,
  version: { type: Number, default: 1, min: 1 },
}, { timestamps: true, collection: 'hourly_sku_location_prices' });

schema.index({ skuId: 1, locationType: 1, locationId: 1 }, { unique: true });
const HourlySkuLocationPrice: Model<IHourlySkuLocationPrice> = mongoose.models.HourlySkuLocationPrice || mongoose.model<IHourlySkuLocationPrice>('HourlySkuLocationPrice', schema);
export default HourlySkuLocationPrice;
