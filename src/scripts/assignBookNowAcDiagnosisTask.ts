/**
 * One-off: assign Book Now task "AC Diagnosis / Inspection" to C V Tarun.
 *
 * Usage:
 *   npx ts-node src/scripts/assignBookNowAcDiagnosisTask.ts
 *   npx ts-node src/scripts/assignBookNowAcDiagnosisTask.ts --dry-run
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Database } from '../config/database';
import Task from '../models/Task';
import BookingOrder from '../models/BookingOrder';
import { TaskService } from '../services/TaskService';

dotenv.config();

const TASK_ID = '6a3bc58dd833cdccfe229044';
const BOOKING_ORDER_ID = '589bbb2b-53c3-40f8-aca6-ea37088ef542';

const HELPER_PROFILE_ID = '6a21491079e328aec4ab9a8a';
const HELPER_UID = '3vsCkBGveYdBOQi2PFYLA1yXYcf1';
const HELPER_NAME = 'C V Tarun';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await Database.connectToDb();

  const task = await Task.findById(TASK_ID).lean();
  if (!task) {
    throw new Error(`Task not found: ${TASK_ID}`);
  }
  if (task.bookingSource !== 'book_now') {
    throw new Error(`Task ${TASK_ID} is not a Book Now task`);
  }

  const order = await BookingOrder.findOne({ orderId: BOOKING_ORDER_ID }).lean();
  if (!order) {
    throw new Error(`Booking order not found: ${BOOKING_ORDER_ID}`);
  }

  const assignedAt = new Date();
  const taskUpdate = {
    assigneeId: new mongoose.Types.ObjectId(HELPER_PROFILE_ID),
    assigneeUid: HELPER_UID,
    assigneeName: HELPER_NAME,
    status: 'assigned',
    assignmentStatus: 'assigned',
    assignedAt,
    updatedAt: assignedAt,
  };

  console.log('Task before:', {
    _id: task._id,
    title: task.title,
    status: task.status,
    assignmentStatus: task.assignmentStatus,
    assigneeId: task.assigneeId,
    bookingOrderId: task.bookingOrderId,
  });

  console.log('Booking order before:', {
    orderId: order.orderId,
    status: order.status,
  });

  console.log('\nPlanned updates:', {
    task: taskUpdate,
    bookingOrder: { status: 'assigned', updatedAt: assignedAt },
  });

  if (dryRun) {
    console.log('\nDry run — no changes written.');
    return;
  }

  await Task.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(TASK_ID) },
    { $set: taskUpdate },
  );

  await BookingOrder.updateOne(
    { orderId: BOOKING_ORDER_ID },
    { $set: { status: 'assigned', updatedAt: assignedAt } },
  );

  TaskService.invalidateTaskCache(TASK_ID);

  const updatedTask = await Task.findById(TASK_ID).lean();
  const updatedOrder = await BookingOrder.findOne({ orderId: BOOKING_ORDER_ID }).lean();

  console.log('\nDone.');
  console.log('Task after:', {
    _id: updatedTask?._id,
    status: updatedTask?.status,
    assignmentStatus: updatedTask?.assignmentStatus,
    assigneeId: updatedTask?.assigneeId,
    assigneeUid: updatedTask?.assigneeUid,
    assigneeName: (updatedTask as Record<string, unknown> | null)?.assigneeName,
    assignedAt: updatedTask?.assignedAt,
  });
  console.log('Booking order after:', {
    orderId: updatedOrder?.orderId,
    status: updatedOrder?.status,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Database.disconnectFromDb();
  });
