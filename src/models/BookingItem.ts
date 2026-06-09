import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IBookingItem extends Document {
  orderId: string;
  skuId: Types.ObjectId;
  variantId?: Types.ObjectId;
  addonIds: Types.ObjectId[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taskId?: Types.ObjectId;
  skuSnapshot?: {
    name: string;
    slug: string;
    categorySlug?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const BookingItemSchema = new Schema<IBookingItem>(
  {
    orderId: { type: String, required: true, index: true },
    skuId: { type: Schema.Types.ObjectId, ref: 'ServiceSku', required: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ServiceVariant' },
    addonIds: [{ type: Schema.Types.ObjectId, ref: 'ServiceAddon' }],
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
    skuSnapshot: {
      name: String,
      slug: String,
      categorySlug: String,
    },
  },
  { timestamps: true }
);

const BookingItem: Model<IBookingItem> =
  mongoose.models.BookingItem || mongoose.model<IBookingItem>('BookingItem', BookingItemSchema);

export default BookingItem;
