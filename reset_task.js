// Reset task to assigned phase for re-testing Start Journey flow
// Run from: extrahand-platform-task-service/

const path = require('path');

// Load env
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = process.env.MONGODB_DB || 'extrahand';

const TASK_ID = '6a549f294813936ab1d60078';

(async () => {
  try {
    console.log('Connecting to MongoDB:', MONGO_URI.replace(/\/\/.*@/, '//<credentials>@'));
    await mongoose.connect(MONGO_URI, { dbName: DB, serverSelectionTimeoutMS: 10000 });
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const result = await db.collection('tasks').updateOne(
      { _id: new mongoose.Types.ObjectId(TASK_ID) },
      {
        $set: { executionPhase: 'assigned' },
        $unset: { startOtp: '' }
      }
    );

    if (result.modifiedCount === 1) {
      console.log(`✅ Task ${TASK_ID} reset to executionPhase='assigned', startOtp cleared.`);
      console.log('👉 You can now click "Start Journey" again in the app!');
    } else {
      console.log(`⚠️  No document modified. Check if task ID is correct. matchedCount=${result.matchedCount}`);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
