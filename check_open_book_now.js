const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

mongoose.connect(MONGO_URI, { dbName: DB }).then(async () => {
  console.log('Querying open book_now tasks in MongoDB...');
  const tasks = await mongoose.connection.db.collection('tasks')
    .find({ bookingSource: 'book_now', status: 'open' })
    .toArray();

  console.log('Found tasks count:', tasks.length);
  console.log(JSON.stringify(tasks.map(t => ({
    _id: t._id,
    title: t.title,
    bookingSource: t.bookingSource,
    status: t.status,
    category: t.category,
    location: t.location,
    partnerId: t.partnerId,
    partnerUid: t.partnerUid,
    assigneeId: t.assigneeId,
  })), null, 2));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
