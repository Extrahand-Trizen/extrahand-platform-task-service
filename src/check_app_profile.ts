import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const MONGODB_DB = 'extrahand';

async function check() {
  try {
    console.log('Connecting to Mongo...');
    await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB });
    console.log('Connected!');

    const appId = '6a61e0c9f77b16db826e4d89';
    const app = await mongoose.connection.collection('taskapplications').findOne({ _id: new mongoose.Types.ObjectId(appId) });
    console.log('Application:', app);

    if (app) {
      const profile = await mongoose.connection.collection('profiles').findOne({ _id: app.applicantId });
      console.log('Profile:', profile);
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

check();
