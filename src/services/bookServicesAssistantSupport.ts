import mongoose from 'mongoose';
import type { IBookingOrder } from '../models/BookingOrder';
import type { ITask } from '../models/Task';
import { BadRequestError, ConflictError } from '../errors/AppError';

export const BOOK_SERVICES_ASSISTANT_OPTIONS = [
  { id: 'booking_status', label: 'Check booking status' },
  { id: 'schedule', label: 'Check date and time' },
  { id: 'professional', label: 'Check assigned professional' },
  { id: 'support', label: 'Contact support' },
] as const;

export type BookServicesAssistantOptionId =
  (typeof BOOK_SERVICES_ASSISTANT_OPTIONS)[number]['id'];
export type BookServicesAssistantUiMode = 'guided' | 'free_text';

export interface BookServicesAssistantPublicMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface BookServicesAssistantPublicConversation {
  conversationId: string;
  bookingOrderId: string;
  taskId?: string;
  status: 'open' | 'ended';
  messages: BookServicesAssistantPublicMessage[];
}

export interface BookServicesAssistantBookingSummary {
  status: string;
  fulfillmentType?: string;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: string;
  serviceType?: string;
  bookingKind?: string;
}

export interface BookServicesAssistantMessageInput {
  text: string;
  optionId?: BookServicesAssistantOptionId;
  clientMessageId?: string;
}

export interface BookServicesAssistantStoredMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt: Date;
  clientMessageId?: string;
  optionId?: string;
  replyToClientMessageId?: string;
}

export function validateBookingOrderId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestError('bookingOrderId is required');
  }
  const bookingOrderId = value.trim();
  if (!bookingOrderId || bookingOrderId.length > 128) {
    throw new BadRequestError('bookingOrderId must be between 1 and 128 characters');
  }
  return bookingOrderId;
}

export function validateTaskId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value.trim()) || !mongoose.isValidObjectId(value.trim())) {
    throw new BadRequestError('taskId must be a valid task ID');
  }
  return value.trim();
}

export function validateConversationId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new BadRequestError('conversationId must be a UUID');
  }
  return value;
}

export function validateMessageInput(value: unknown): BookServicesAssistantMessageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError('Request body must be an object');
  }

  const body = value as Record<string, unknown>;
  if (typeof body.text !== 'string') {
    throw new BadRequestError('text is required');
  }
  const text = body.text.trim();
  if (!text || text.length > 2000) {
    throw new BadRequestError('text must be between 1 and 2000 characters');
  }

  let optionId: BookServicesAssistantOptionId | undefined;
  if (body.optionId !== undefined) {
    if (
      typeof body.optionId !== 'string' ||
      !BOOK_SERVICES_ASSISTANT_OPTIONS.some((option) => option.id === body.optionId)
    ) {
      throw new BadRequestError('optionId is not a supported option');
    }
    optionId = body.optionId as BookServicesAssistantOptionId;
  }

  let clientMessageId: string | undefined;
  if (body.clientMessageId !== undefined) {
    if (
      typeof body.clientMessageId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.clientMessageId)
    ) {
      throw new BadRequestError('clientMessageId must contain 1 to 128 letters, digits, _ or -');
    }
    clientMessageId = body.clientMessageId;
  }

  return { text, optionId, clientMessageId };
}

export function toPublicConversation(
  conversation: {
    conversationId: string;
    bookingOrderId: string;
    taskId?: string | null;
    status: 'open' | 'ended';
    messages: Array<{ role: 'user' | 'assistant'; text: string; createdAt: Date | string }>;
  },
): BookServicesAssistantPublicConversation {
  return {
    conversationId: conversation.conversationId,
    bookingOrderId: conversation.bookingOrderId,
    ...(conversation.taskId ? { taskId: String(conversation.taskId) } : {}),
    status: conversation.status,
    messages: conversation.messages.map((message) => ({
      role: message.role,
      text: message.text,
      createdAt: new Date(message.createdAt).toISOString(),
    })),
  };
}

export function findIdempotentAssistantReply(
  messages: BookServicesAssistantStoredMessage[],
  clientMessageId: string,
  input: BookServicesAssistantMessageInput,
): { role: 'assistant'; text: string; createdAt: string } | null {
  const userMessage = messages.find((message) => message.clientMessageId === clientMessageId);
  if (!userMessage) return null;
  if (userMessage.text !== input.text || userMessage.optionId !== input.optionId) {
    throw new ConflictError('clientMessageId has already been used for a different message');
  }
  const reply = messages.find(
    (message) => message.replyToClientMessageId === clientMessageId,
  );
  if (!reply) {
    throw new ConflictError('The prior message is incomplete; use a new clientMessageId');
  }
  return {
    role: 'assistant',
    text: reply.text,
    createdAt: new Date(reply.createdAt).toISOString(),
  };
}

export function toBookingSummary(order: IBookingOrder): BookServicesAssistantBookingSummary {
  return {
    status: order.status,
    ...(order.fulfillmentType ? { fulfillmentType: order.fulfillmentType } : {}),
    ...(order.scheduledDate ? { scheduledDate: new Date(order.scheduledDate).toISOString() } : {}),
    ...(order.scheduledTimeStart ? { scheduledTimeStart: order.scheduledTimeStart } : {}),
    ...(order.scheduledTimeEnd ? { scheduledTimeEnd: order.scheduledTimeEnd } : {}),
    ...(order.timeSlot ? { timeSlot: order.timeSlot } : {}),
    ...(order.serviceType ? { serviceType: order.serviceType } : {}),
    ...(order.bookingKind ? { bookingKind: order.bookingKind } : {}),
  };
}

export function resolveAssistantIntent(
  input: BookServicesAssistantMessageInput,
): { intent?: BookServicesAssistantOptionId; uiMode: BookServicesAssistantUiMode } {
  if (input.optionId) return { intent: input.optionId, uiMode: 'guided' };

  const text = input.text.toLowerCase();
  if (/\b(payment|refund|cancel|cancellation|change|modify|reschedule|charge|billing)\b/.test(text)) {
    return { intent: 'support', uiMode: 'guided' };
  }
  if (/\b(schedule|date|time|when|slot)\b/.test(text)) {
    return { intent: 'schedule', uiMode: 'guided' };
  }
  if (/\b(helper|professional|partner|assigned|who)\b/.test(text)) {
    return { intent: 'professional', uiMode: 'guided' };
  }
  if (/\b(status|booking|order|paid)\b/.test(text)) {
    return { intent: 'booking_status', uiMode: 'guided' };
  }
  if (/\b(support|human|contact)\b/.test(text)) {
    return { intent: 'support', uiMode: 'guided' };
  }
  return { uiMode: 'free_text' };
}

export function buildAssistantReply(
  input: BookServicesAssistantMessageInput,
  order: IBookingOrder,
  task?: ITask | null,
): string {
  const { intent } = resolveAssistantIntent(input);
  switch (intent) {
    case 'booking_status':
      return `The booking record shows status "${order.status}". I can’t make changes to the booking.`;
    case 'schedule': {
      const date = order.scheduledDate
        ? new Date(order.scheduledDate).toISOString().slice(0, 10)
        : undefined;
      const time = [order.scheduledTimeStart, order.scheduledTimeEnd].filter(Boolean).join('–');
      const details = [date, time, !time ? order.timeSlot : undefined]
        .filter(Boolean)
        .join(' ');
      return details
        ? `The booking record lists this schedule: ${details}.`
        : 'The booking record does not currently list a scheduled date or time.';
    }
    case 'professional': {
      if (!task) {
        return 'I can’t confirm an assigned professional because no associated Book Now task is available. You can check again later or contact support through the app.';
      }
      const name = task.assignedHelperName || task.assignedToName || task.assigneeName;
      const isAssigned = Boolean(task.assigneeId || task.assigneeUid);
      if (isAssigned && name) {
        return `The associated task lists ${name} as the assigned professional.`;
      }
      if (!isAssigned) {
        return 'The associated task does not currently show an assigned professional.';
      }
      return 'The associated task indicates a professional is assigned, but does not include a name I can confirm. Please contact support through the app for help.';
    }
    case 'support':
    default:
      return 'I can share details recorded for this booking, but I can’t perform booking changes or determine cancellation, refund, or other policy outcomes. For help with an action or decision, contact support through the app and include your booking order ID.';
  }
}
