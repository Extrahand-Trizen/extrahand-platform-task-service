const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

mongoose.connect(MONGO_URI, { dbName: DB }).then(async () => {
  console.log('Querying completed tasks in MongoDB...');
  const tasks = await mongoose.connection.db.collection('tasks')
    .find({ status: 'completed' })
    .sort({ updatedAt: -1 })
    .limit(5)
    .toArray();

  console.log('Latest 5 completed tasks:');
  console.log(JSON.stringify(tasks, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
