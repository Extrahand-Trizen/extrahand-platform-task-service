import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IBookingItem extends Document {
  orderId: string;
  /** Optional when checkout uses mobile app catalog (skuSnapshot only). */
  skuId?: Types.ObjectId;
  variantId?: Types.ObjectId;
  addonIds: Types.ObjectId[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taskId?: Types.ObjectId;
  status?: 'active' | 'cancelled';
  cancelledAt?: Date;
  cancellationReason?: string;
  skuSnapshot?: {
    name: string;
    slug: string;
    categorySlug?: string;
  };
  scheduledDate?: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: 'morning' | 'midday' | 'afternoon' | 'evening';
  durationMinutes?: number;
  createdAt: Date;
  updatedAt: Date;
}

const BookingItemSchema = new Schema<IBookingItem>(
  {
    orderId: { type: String, required: true, index: true },
    skuId: { type: Schema.Types.ObjectId, ref: 'ServiceSku' },
    variantId: { type: Schema.Types.ObjectId, ref: 'ServiceVariant' },
    addonIds: [{ type: Schema.Types.ObjectId, ref: 'ServiceAddon' }],
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
    status: {
      type: String,
      enum: ['active', 'cancelled'],
      default: 'active',
      index: true,
    },
    cancelledAt: Date,
    cancellationReason: String,
    skuSnapshot: {
      name: String,
      slug: String,
      categorySlug: String,
    },
    scheduledDate: Date,
    scheduledTimeStart: String,
    scheduledTimeEnd: String,
    timeSlot: { type: String, enum: ['morning', 'midday', 'afternoon', 'evening'] },
    durationMinutes: { type: Number, min: 1 },
  },
  { timestamps: true }
);

const BookingItem: Model<IBookingItem> =
  mongoose.models.BookingItem || mongoose.model<IBookingItem>('BookingItem', BookingItemSchema);

export default BookingItem;
