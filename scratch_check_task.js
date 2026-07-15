const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

mongoose.connect(MONGO_URI, { dbName: DB }).then(async () => {
  console.log('Querying task 6a5719c90895555ee8383074 in MongoDB...');
  const task = await mongoose.connection.db.collection('tasks')
    .findOne({ _id: new mongoose.Types.ObjectId('6a5719c90895555ee8383074') });

  console.log('Task details:');
  console.log(JSON.stringify(task, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
