const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

async function checkTasks() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/extrahand-task-service');
    const db = mongoose.connection;
    
    const tasksCollection = db.collection('tasks');
    const taskCount = await tasksCollection.countDocuments();
    console.log('📋 Total tasks in database:', taskCount);
    
    const completedTasks = await tasksCollection.find({ status: 'completed' }).toArray();
    console.log('✅ Completed tasks:', completedTasks.length);
    
    if (completedTasks.length > 0) {
      console.log('📝 Completed tasks details:');
      completedTasks.forEach((task, idx) => {
        console.log(`  ${idx + 1}. "${task.title}" - Assignee: ${task.assigneeId}, Status: ${task.status}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkTasks();
