import dns from 'node:dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import mongoose from 'mongoose';
import Task from '../models/Task';
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

    // 1. Check the specific task
    const taskId = '6a5719c90895555ee8383074';
    const task = await Task.findById(taskId);
    console.log('--- TASK DETAILS ---');
    console.log(JSON.stringify(task, null, 2));

    // 2. Check the partner profile
    const partnerUid = 'f81kdwayhkPuc039NXNixBmNI7u2';
    const Profile = mongoose.connection.collection('profiles');
    const profile = await Profile.findOne({ uid: partnerUid });
    console.log('--- PARTNER PROFILE DETAILS ---');
    console.log(JSON.stringify(profile, null, 2));

    // 3. Check all open book_now tasks in DB
    const bookNowTasks = await Task.find({ bookingSource: 'book_now' });
    console.log('--- ALL BOOK NOW TASKS ---');
    console.log(bookNowTasks.map(t => ({ id: t._id, title: t.title, status: t.status, category: t.category, scheduledDate: t.scheduledDate })));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
