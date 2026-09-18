const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';

async function run() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  
  const order = await db.collection('bookingorders').findOne({ orderId: '4b2d8276-e9b6-4668-ab27-ee44f57263b0' });
  console.log('Order:', order ? { orderId: order.orderId, status: order.status, paymentEscrowId: order.paymentEscrowId } : 'Not found');
  
  const items = await db.collection('bookingitems').find({ orderId: '4b2d8276-e9b6-4668-ab27-ee44f57263b0' }).toArray();
  console.log('Items count:', items.length);
  for (const item of items) {
    console.log('  Item:', { itemId: item._id, taskId: item.taskId });
    if (item.taskId) {
      const task = await db.collection('tasks').findOne({ _id: item.taskId });
      console.log('    Task found in DB:', task ? { _id: task._id, title: task.title, status: task.status } : 'Not found');
    }
  }

  await mongoose.disconnect();
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

