const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

mongoose.connect(MONGO_URI, { dbName: DB }).then(async () => {
  const task = await mongoose.connection.db.collection('tasks').findOne({ title: /Flush Tank/i });
  console.log('Task Details:', JSON.stringify(task, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
