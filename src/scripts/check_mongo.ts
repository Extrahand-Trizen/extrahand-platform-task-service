import mongoose from 'mongoose';
import BookingOrder from '../models/BookingOrder';
import BookingItem from '../models/BookingItem';
import Task from '../models/Task';
import Assignment from '../models/Assignment';
import { config } from '../config/env';

async function main() {
  const uri = config.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri, {
      dbName: 'extrahand'
    });
    console.log('Connected to MongoDB');

    const orderId = '8c9e23d7-97f7-4b32-b36c-a67fcbf27e06';
    const order = await BookingOrder.findById(orderId);
    console.log('BookingOrder:', JSON.stringify(order, null, 2));

    if (order) {
      const items = await BookingItem.find({ bookingOrderId: orderId });
      console.log('BookingItems:', JSON.stringify(items, null, 2));

      for (const item of items) {
        if (item.taskId) {
          const task = await Task.findById(item.taskId);
          console.log(`Task for item ${item._id}:`, JSON.stringify(task, null, 2));
        }
      }
    }

    const assignments = await Assignment.find({ bookingOrderId: orderId });
    console.log('Assignments:', JSON.stringify(assignments, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
