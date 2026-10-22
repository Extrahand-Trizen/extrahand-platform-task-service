import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type BookServicesAssistantRole = 'user' | 'assistant';
export type BookServicesAssistantStatus = 'open' | 'ended';

export interface IBookServicesAssistantMessage {
  role: BookServicesAssistantRole;
  text: string;
  createdAt: Date;
  clientMessageId?: string;
  optionId?: string;
  replyToClientMessageId?: string;
}

export interface IBookServicesAssistantConversation extends Document {
  conversationId: string;
  ownerUid: string;
  bookingOrderId: string;
  taskId?: string;
  status: BookServicesAssistantStatus;
  messages: IBookServicesAssistantMessage[];
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IBookServicesAssistantMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, required: true },
    clientMessageId: { type: String, maxlength: 128 },
    optionId: { type: String, maxlength: 32 },
    replyToClientMessageId: { type: String, maxlength: 128 },
  },
  { _id: false },
);

const BookServicesAssistantConversationSchema =
  new Schema<IBookServicesAssistantConversation>(
    {
      conversationId: { type: String, required: true, unique: true, index: true },
      ownerUid: { type: String, required: true },
      bookingOrderId: { type: String, required: true },
      taskId: { type: String },
      status: { type: String, enum: ['open', 'ended'], required: true, default: 'open' },
      messages: { type: [MessageSchema], default: [] },
      endedAt: { type: Date },
    },
    { timestamps: true },
  );

BookServicesAssistantConversationSchema.index(
  { ownerUid: 1, bookingOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'open' },
    name: 'one_open_book_services_assistant_per_booking',
  },
);
BookServicesAssistantConversationSchema.index(
  { conversationId: 1, ownerUid: 1 },
  { name: 'book_services_assistant_owner_lookup' },
);

const BookServicesAssistantConversation: Model<IBookServicesAssistantConversation> =
  mongoose.models.BookServicesAssistantConversation ||
  mongoose.model<IBookServicesAssistantConversation>(
    'BookServicesAssistantConversation',
    BookServicesAssistantConversationSchema,
  );

export default BookServicesAssistantConversation;
