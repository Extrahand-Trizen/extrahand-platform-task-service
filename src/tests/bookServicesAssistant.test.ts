import assert from 'assert';
import mongoose from 'mongoose';
import type { IBookingOrder } from '../models/BookingOrder';
import BookingOrder from '../models/BookingOrder';
import Task from '../models/Task';
import BookServicesAssistantConversation from '../models/BookServicesAssistantConversation';
import { BookServicesAssistantService } from '../services/BookServicesAssistantService';
import {
  BOOK_SERVICES_ASSISTANT_OPTIONS,
  buildAssistantReply,
  findIdempotentAssistantReply,
  resolveAssistantIntent,
  toPublicConversation,
  validateBookingOrderId,
  validateConversationId,
  validateMessageInput,
  validateTaskId,
} from '../services/bookServicesAssistantSupport';
import { BadRequestError, ConflictError, NotFoundError } from '../errors/AppError';

const order = {
  orderId: 'ORD-BOOK-123',
  status: 'paid',
  fulfillmentType: 'scheduled',
  scheduledDate: new Date('2026-11-03T00:00:00.000Z'),
  scheduledTimeStart: '10:00',
  scheduledTimeEnd: '11:00',
} as IBookingOrder;

function testRequestValidation(): void {
  assert.strictEqual(validateBookingOrderId(' ORD-BOOK-123 '), 'ORD-BOOK-123');
  assert.throws(() => validateBookingOrderId('  '), BadRequestError);
  assert.strictEqual(validateTaskId(new mongoose.Types.ObjectId().toString())?.length, 24);
  assert.throws(() => validateTaskId('ORD-BOOK-123'), BadRequestError);
  assert.strictEqual(
    validateConversationId('a24f6393-54d0-4b54-a1ce-0648774f874b'),
    'a24f6393-54d0-4b54-a1ce-0648774f874b',
  );
  assert.throws(() => validateConversationId('ORD-BOOK-123'), BadRequestError);
  assert.deepStrictEqual(
    validateMessageInput({
      text: '  Please check status ',
      optionId: 'booking_status',
      clientMessageId: 'retry_123',
    }),
    {
      text: 'Please check status',
      optionId: 'booking_status',
      clientMessageId: 'retry_123',
    },
  );
  assert.throws(() => validateMessageInput({ text: '  ' }), BadRequestError);
  assert.throws(
    () => validateMessageInput({ text: 'status', clientMessageId: 'not allowed!' }),
    BadRequestError,
  );
}

function testDeterministicGroundedReplies(): void {
  assert.strictEqual(BOOK_SERVICES_ASSISTANT_OPTIONS.length, 4);
  assert.strictEqual(
    buildAssistantReply({ text: 'what is the status?', optionId: 'booking_status' }, order),
    'The booking record shows status "paid". I can’t make changes to the booking.',
  );
  assert.strictEqual(
    buildAssistantReply({ text: 'when is it?', optionId: 'schedule' }, order),
    'The booking record lists this schedule: 2026-11-03 10:00–11:00.',
  );
  assert.match(
    buildAssistantReply({ text: 'who is assigned?', optionId: 'professional' }, order),
    /no associated Book Now task is available/,
  );
  assert.match(
    buildAssistantReply({ text: 'Can you refund this?' }, order),
    /can’t perform booking changes/,
  );
  assert.deepStrictEqual(
    resolveAssistantIntent({ text: 'Can I get a refund?' }),
    { intent: 'support', uiMode: 'guided' },
  );
  assert.deepStrictEqual(
    resolveAssistantIntent({ text: 'I have a payment issue' }),
    { intent: 'support', uiMode: 'guided' },
  );
  assert.deepStrictEqual(
    resolveAssistantIntent({ text: 'What is the payment status?' }),
    { intent: 'support', uiMode: 'guided' },
  );
  assert.deepStrictEqual(
    resolveAssistantIntent({ text: 'I have another question' }),
    { uiMode: 'free_text' },
  );
}

function testConversationProjectionAndIndexes(): void {
  const publicConversation = toPublicConversation({
    conversationId: 'a24f6393-54d0-4b54-a1ce-0648774f874b',
    bookingOrderId: 'ORD-BOOK-123',
    status: 'open',
    messages: [
      {
        role: 'user',
        text: 'Check status',
        createdAt: new Date('2026-10-21T10:00:00.000Z'),
        clientMessageId: 'private-retry-id',
      },
    ] as any,
  });
  assert.deepStrictEqual(publicConversation, {
    conversationId: 'a24f6393-54d0-4b54-a1ce-0648774f874b',
    bookingOrderId: 'ORD-BOOK-123',
    status: 'open',
    messages: [
      {
        role: 'user',
        text: 'Check status',
        createdAt: '2026-10-21T10:00:00.000Z',
      },
    ],
  });
  const indexes = BookServicesAssistantConversation.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.ownerUid === 1 &&
    keys.bookingOrderId === 1 &&
    options.unique === true &&
    (options.partialFilterExpression as Record<string, unknown>)?.status === 'open',
  ));
}

function testIdempotencyErrorType(): void {
  const messages = [
    {
      role: 'user' as const,
      text: 'Check status',
      optionId: 'booking_status',
      clientMessageId: 'retry_123',
      createdAt: new Date('2026-10-21T10:00:00.000Z'),
    },
    {
      role: 'assistant' as const,
      text: 'The booking record shows status "paid".',
      replyToClientMessageId: 'retry_123',
      createdAt: new Date('2026-10-21T10:00:01.000Z'),
    },
  ];
  const retryInput = {
    text: 'Check status',
    optionId: 'booking_status' as const,
    clientMessageId: 'retry_123',
  };
  assert.deepStrictEqual(
    findIdempotentAssistantReply(messages, 'retry_123', retryInput),
    {
      role: 'assistant',
      text: 'The booking record shows status "paid".',
      createdAt: '2026-10-21T10:00:01.000Z',
    },
  );
  assert.throws(
    () => findIdempotentAssistantReply(messages, 'retry_123', { ...retryInput, text: 'Different' }),
    (error: unknown) => error instanceof ConflictError && error.statusCode === 409,
  );
  assert.throws(
    () => findIdempotentAssistantReply(messages.slice(0, 1), 'retry_123', retryInput),
    (error: unknown) => error instanceof ConflictError && error.statusCode === 409,
  );
}

async function testServiceLifecycleAndAuthorization(): Promise<void> {
  const bookingModel = BookingOrder as any;
  const taskModel = Task as any;
  const conversationModel = BookServicesAssistantConversation as any;
  const originals = {
    bookingFindOne: bookingModel.findOne,
    taskFindOne: taskModel.findOne,
    conversationFindOne: conversationModel.findOne,
    conversationUpdateOne: conversationModel.updateOne,
  };
  const validOrder = {
    orderId: 'ORD-BOOK-123',
    customerUid: 'customer-1',
    status: 'paid',
    fulfillmentType: 'scheduled',
  };
  const validTask = {
    _id: new mongoose.Types.ObjectId(),
    bookingOrderId: validOrder.orderId,
    bookingSource: 'book_now',
    requesterUid: validOrder.customerUid,
    assigneeUid: 'helper-1',
    assignedHelperName: 'A verified helper',
  };
  const records: any[] = [];

  bookingModel.findOne = async (query: Record<string, string>) =>
    query.orderId === validOrder.orderId &&
    query.customerUid === validOrder.customerUid
      ? validOrder
      : null;
  taskModel.findOne = async (query: Record<string, any>) =>
    String(query._id) === String(validTask._id) &&
    query.bookingOrderId === validOrder.orderId &&
    query.bookingSource === 'book_now'
      ? validTask
      : null;
  conversationModel.findOne = async (query: Record<string, unknown>) =>
    records.find((record) =>
      Object.entries(query).every(([key, value]) => record[key] === value),
    ) ?? null;
  conversationModel.updateOne = async (
    query: Record<string, any>,
    update: Record<string, any>,
  ) => {
    let record = records.find((candidate) =>
      Object.entries(query)
        .filter(([key]) => !key.startsWith('messages.'))
        .every(([key, value]) => candidate[key] === value),
    );
    if (update.$setOnInsert && !record) {
      record = { ...update.$setOnInsert };
      records.push(record);
      return { upsertedCount: 1, modifiedCount: 0 };
    }
    if (!record) return { upsertedCount: 0, modifiedCount: 0 };
    if (query['messages.clientMessageId']?.$ne) {
      const existing = record.messages.some(
        (message: any) =>
          message.clientMessageId === query['messages.clientMessageId'].$ne,
      );
      if (existing) return { upsertedCount: 0, modifiedCount: 0 };
    }
    if (update.$set) Object.assign(record, update.$set);
    if (update.$push?.messages?.$each) {
      record.messages.push(...update.$push.messages.$each);
    }
    if (update.$set?.taskId && !record.taskId) record.taskId = update.$set.taskId;
    return { upsertedCount: 0, modifiedCount: 1 };
  };

  try {
    const taskId = String(validTask._id);
    const [firstStart, concurrentStart] = await Promise.all([
      BookServicesAssistantService.startConversation('customer-1', {
        bookingOrderId: validOrder.orderId,
        taskId,
      }),
      BookServicesAssistantService.startConversation('customer-1', {
        bookingOrderId: validOrder.orderId,
        taskId,
      }),
    ]);
    const firstConversation = firstStart.conversation as any;
    const resumedConversation = concurrentStart.conversation as any;
    assert.strictEqual(records.length, 1);
    assert.strictEqual(firstConversation.conversationId, resumedConversation.conversationId);
    assert.strictEqual(firstConversation.bookingOrderId, validOrder.orderId);
    assert.strictEqual(firstConversation.taskId, taskId);

    await assert.rejects(
      () => BookServicesAssistantService.startConversation('customer-2', {
        bookingOrderId: validOrder.orderId,
      }),
      NotFoundError,
    );
    await assert.rejects(
      () => BookServicesAssistantService.startConversation('customer-1', {
        bookingOrderId: validOrder.orderId,
        taskId: new mongoose.Types.ObjectId().toString(),
      }),
      NotFoundError,
    );
    await assert.rejects(
      () => BookServicesAssistantService.getConversation(
        'customer-2',
        firstConversation.conversationId,
      ),
      NotFoundError,
    );

    const input = {
      text: 'Check booking status',
      optionId: 'booking_status',
      clientMessageId: 'service_retry_1',
    };
    const sent = await BookServicesAssistantService.sendMessage(
      'customer-1',
      firstConversation.conversationId,
      input,
    );
    const retried = await BookServicesAssistantService.sendMessage(
      'customer-1',
      firstConversation.conversationId,
      input,
    );
    assert.strictEqual(records[0].messages.length, 3);
    assert.deepStrictEqual(sent.assistantMessage, retried.assistantMessage);
    await assert.rejects(
      () => BookServicesAssistantService.sendMessage(
        'customer-1',
        firstConversation.conversationId,
        { ...input, text: 'A different message' },
      ),
      ConflictError,
    );

    const ended = await BookServicesAssistantService.endConversation(
      'customer-1',
      firstConversation.conversationId,
    );
    assert.strictEqual((ended.conversation as any).status, 'ended');
    const endedAgain = await BookServicesAssistantService.endConversation(
      'customer-1',
      firstConversation.conversationId,
    );
    assert.strictEqual((endedAgain.conversation as any).status, 'ended');
    await assert.rejects(
      () => BookServicesAssistantService.sendMessage(
        'customer-1',
        firstConversation.conversationId,
        { text: 'A new message', clientMessageId: 'service_retry_2' },
      ),
      ConflictError,
    );

    const afterEnd = await BookServicesAssistantService.startConversation(
      'customer-1',
      { bookingOrderId: validOrder.orderId },
    );
    assert.notStrictEqual(
      (afterEnd.conversation as any).conversationId,
      firstConversation.conversationId,
    );
    assert.strictEqual(records.length, 2);
  } finally {
    bookingModel.findOne = originals.bookingFindOne;
    taskModel.findOne = originals.taskFindOne;
    conversationModel.findOne = originals.conversationFindOne;
    conversationModel.updateOne = originals.conversationUpdateOne;
  }
}

async function run(): Promise<void> {
  testRequestValidation();
  testDeterministicGroundedReplies();
  testConversationProjectionAndIndexes();
  testIdempotencyErrorType();
  await testServiceLifecycleAndAuthorization();
  console.log('bookServicesAssistant.test.ts: all tests passed');
}

void run().catch((error: unknown) => {
  console.error('bookServicesAssistant.test.ts failed:', error);
  process.exitCode = 1;
});
