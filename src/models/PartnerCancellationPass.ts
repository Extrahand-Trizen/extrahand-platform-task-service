import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPartnerCancellationPass extends Document {
  partnerUid: string;
  month: number;
  year: number;
  usedPasses: number;
  totalPasses: number;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerCancellationPassSchema = new Schema<IPartnerCancellationPass>(
  {
    partnerUid: { type: String, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    usedPasses: { type: Number, default: 0, min: 0 },
    totalPasses: { type: Number, default: 3 },
  },
  { timestamps: true }
);

PartnerCancellationPassSchema.index({ partnerUid: 1, month: 1, year: 1 }, { unique: true });

const PartnerCancellationPass: Model<IPartnerCancellationPass> =
  mongoose.models.PartnerCancellationPass ||
  mongoose.model<IPartnerCancellationPass>('PartnerCancellationPass', PartnerCancellationPassSchema);

export default PartnerCancellationPass;
