import dns from 'node:dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import mongoose from 'mongoose';
import { config } from '../config/env';

async function main() {
  const uri = config.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri, { dbName: 'extrahand' });
    const TARGET_UID = 'f81kdwayhkPuc039NXNixBmNI7u2';
    const Profile = mongoose.connection.collection('profiles');
    const profile = await Profile.findOne({ uid: TARGET_UID });
    console.log('--- PARTNER PROFILE DETAILS ---');
    console.log(JSON.stringify(profile, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
