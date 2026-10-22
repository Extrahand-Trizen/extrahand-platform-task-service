import { randomUUID } from 'crypto';
import type { IBookingOrder } from '../models/BookingOrder';
import BookingOrder from '../models/BookingOrder';
import type { ITask } from '../models/Task';
import Task from '../models/Task';
import BookServicesAssistantConversation, {
  type IBookServicesAssistantConversation,
  type IBookServicesAssistantMessage,
} from '../models/BookServicesAssistantConversation';
import { ConflictError, NotFoundError } from '../errors/AppError';
import {
  BOOK_SERVICES_ASSISTANT_OPTIONS,
  buildAssistantReply,
  findIdempotentAssistantReply,
  resolveAssistantIntent,
  toBookingSummary,
  toPublicConversation,
  validateBookingOrderId,
  validateConversationId,
  validateMessageInput,
  validateTaskId,
} from './bookServicesAssistantSupport';

const INITIAL_ASSISTANT_MESSAGE =
  'Hi, I can help with details recorded for this booking. Choose an option below or ask a question. I can’t make booking changes; contact support through the app for help with actions or policy decisions.';

type BookingContext = {
  order: IBookingOrder;
  task: ITask | null;
};

export class BookServicesAssistantService {
  static async startConversation(
    ownerUid: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const request = body && typeof body === 'object'
      ? body as Record<string, unknown>
      : {};
    const bookingOrderId = validateBookingOrderId(request.bookingOrderId);
    const taskId = validateTaskId(request.taskId);
    const order = await this.findOwnedBooking(bookingOrderId, ownerUid);
    if (taskId) await this.findAssociatedTask(taskId, order);

    const now = new Date();
    const initialMessage: IBookServicesAssistantMessage = {
      role: 'assistant',
      text: INITIAL_ASSISTANT_MESSAGE,
      createdAt: now,
    };
    const conversationId = randomUUID();
    let resumed = false;

    try {
      const result = await BookServicesAssistantConversation.updateOne(
        { ownerUid, bookingOrderId, status: 'open' },
        {
          $setOnInsert: {
            conversationId,
            ownerUid,
            bookingOrderId,
            ...(taskId ? { taskId } : {}),
            status: 'open',
            messages: [initialMessage],
            createdAt: now,
          },
        },
        { upsert: true, runValidators: true },
      );
      resumed = result.upsertedCount !== 1;
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
      resumed = true;
    }

    const openedConversation = await BookServicesAssistantConversation.findOne({
      ownerUid,
      bookingOrderId,
      status: 'open',
    });
    if (!openedConversation) {
      throw new ConflictError('Could not open a support conversation; please retry');
    }
    const conversation = await this.attachTaskIfMissing(openedConversation, taskId);

    return {
      conversation: toPublicConversation(conversation),
      resumed,
      booking: toBookingSummary(order),
      options: BOOK_SERVICES_ASSISTANT_OPTIONS,
      uiMode: 'guided',
    };
  }

  static async getConversation(
    ownerUid: string,
    rawConversationId: unknown,
  ): Promise<Record<string, unknown>> {
    const conversationId = validateConversationId(rawConversationId);
    const conversation = await this.findOwnedConversation(conversationId, ownerUid);
    const context = await this.loadBookingContext(conversation, ownerUid);
    return {
      conversation: toPublicConversation(conversation),
      resumed: true,
      booking: toBookingSummary(context.order),
      options: BOOK_SERVICES_ASSISTANT_OPTIONS,
      uiMode: 'guided',
    };
  }

  static async sendMessage(
    ownerUid: string,
    rawConversationId: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const conversationId = validateConversationId(rawConversationId);
    const input = validateMessageInput(body);
    const conversation = await this.findOwnedConversation(conversationId, ownerUid);
    const context = await this.loadBookingContext(conversation, ownerUid);

    if (input.clientMessageId) {
      const replay = findIdempotentAssistantReply(
        conversation.messages as IBookServicesAssistantMessage[],
        input.clientMessageId,
        input,
      );
      if (replay) {
        return {
          conversation: toPublicConversation(conversation),
          assistantMessage: replay,
          options: BOOK_SERVICES_ASSISTANT_OPTIONS,
          uiMode: resolveAssistantIntent(input).uiMode,
        };
      }
    }
    if (conversation.status !== 'open') {
      throw new ConflictError('This support conversation has ended');
    }

    const now = new Date();
    const assistantText = buildAssistantReply(input, context.order, context.task);
    const userMessage: IBookServicesAssistantMessage = {
      role: 'user',
      text: input.text,
      createdAt: now,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      ...(input.optionId ? { optionId: input.optionId } : {}),
    };
    const assistantStoredMessage: IBookServicesAssistantMessage = {
      role: 'assistant',
      text: assistantText,
      createdAt: now,
      ...(input.clientMessageId ? { replyToClientMessageId: input.clientMessageId } : {}),
    };
    const filter: Record<string, unknown> = {
      conversationId,
      ownerUid,
      status: 'open',
    };
    if (input.clientMessageId) {
      filter['messages.clientMessageId'] = { $ne: input.clientMessageId };
    }

    const updateResult = await BookServicesAssistantConversation.updateOne(
      filter,
      { $push: { messages: { $each: [userMessage, assistantStoredMessage] } } },
      { runValidators: true },
    );
    if (updateResult.modifiedCount !== 1) {
      const latest = await this.findOwnedConversation(conversationId, ownerUid);
      if (input.clientMessageId) {
        const replay = findIdempotentAssistantReply(
          latest.messages as IBookServicesAssistantMessage[],
          input.clientMessageId,
          input,
        );
        if (replay) {
          return {
            conversation: toPublicConversation(latest),
            assistantMessage: replay,
            options: BOOK_SERVICES_ASSISTANT_OPTIONS,
            uiMode: resolveAssistantIntent(input).uiMode,
          };
        }
      }
      if (latest.status !== 'open') {
        throw new ConflictError('This support conversation has ended');
      }
      throw new ConflictError('Message could not be saved; please retry');
    }

    const updatedConversation = await this.findOwnedConversation(conversationId, ownerUid);
    return {
      conversation: toPublicConversation(updatedConversation),
      assistantMessage: {
        role: 'assistant',
        text: assistantText,
        createdAt: now.toISOString(),
      },
      options: BOOK_SERVICES_ASSISTANT_OPTIONS,
      uiMode: resolveAssistantIntent(input).uiMode,
    };
  }

  static async endConversation(
    ownerUid: string,
    rawConversationId: unknown,
  ): Promise<{ conversation: ReturnType<typeof toPublicConversation> }> {
    const conversationId = validateConversationId(rawConversationId);
    await BookServicesAssistantConversation.updateOne(
      { conversationId, ownerUid, status: 'open' },
      { $set: { status: 'ended', endedAt: new Date() } },
    );
    const conversation = await this.findOwnedConversation(conversationId, ownerUid);
    return { conversation: toPublicConversation(conversation) };
  }

  private static async findOwnedBooking(
    bookingOrderId: string,
    ownerUid: string,
  ): Promise<IBookingOrder> {
    const order = await BookingOrder.findOne({
      orderId: bookingOrderId,
      customerUid: ownerUid,
    });
    if (!order) throw new NotFoundError('Booking not found');
    return order;
  }

  private static async findAssociatedTask(
    taskId: string,
    order: IBookingOrder,
  ): Promise<ITask> {
    const task = await Task.findOne({
      _id: taskId,
      bookingOrderId: order.orderId,
      bookingSource: 'book_now',
    });
    if (!task || (task.requesterUid && task.requesterUid !== order.customerUid)) {
      throw new NotFoundError('Task not found for this booking');
    }
    return task;
  }

  private static async findOwnedConversation(
    conversationId: string,
    ownerUid: string,
  ): Promise<IBookServicesAssistantConversation> {
    const conversation = await BookServicesAssistantConversation.findOne({
      conversationId,
      ownerUid,
    });
    if (!conversation) throw new NotFoundError('Support conversation not found');
    return conversation;
  }

  private static async loadBookingContext(
    conversation: IBookServicesAssistantConversation,
    ownerUid: string,
  ): Promise<BookingContext> {
    const order = await this.findOwnedBooking(conversation.bookingOrderId, ownerUid);
    const task = conversation.taskId
      ? await this.findAssociatedTask(conversation.taskId, order)
      : null;
    return { order, task };
  }

  private static async attachTaskIfMissing(
    conversation: IBookServicesAssistantConversation,
    taskId?: string,
  ): Promise<IBookServicesAssistantConversation> {
    if (!taskId || String(conversation.taskId || '') === taskId) return conversation;
    if (conversation.taskId) {
      throw new ConflictError('An open conversation is already associated with another task');
    }
    await BookServicesAssistantConversation.updateOne(
      {
        conversationId: conversation.conversationId,
        ownerUid: conversation.ownerUid,
        status: 'open',
        $or: [{ taskId: { $exists: false } }, { taskId: null }],
      },
      { $set: { taskId } },
    );
    const updated = await BookServicesAssistantConversation.findOne({
      conversationId: conversation.conversationId,
      ownerUid: conversation.ownerUid,
    });
    if (!updated || String(updated.taskId || '') !== taskId) {
      throw new ConflictError('An open conversation is already associated with another task');
    }
    return updated;
  }

}
