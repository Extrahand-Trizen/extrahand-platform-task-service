const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const DB = 'extrahand';

mongoose.connect(MONGO_URI, { dbName: DB }).then(async () => {
  const Profile = mongoose.connection.collection('profiles');
  const profile = await Profile.findOne({ uid: 'f81kdwayhkPuc039NXNixBmNI7u2' });
  if (!profile) {
    console.error('Profile not found');
    process.exit(1);
  }
  const profileId = String(profile._id);
  const uid = 'f81kdwayhkPuc039NXNixBmNI7u2';
  
  console.log(`Making request with profileId: ${profileId}, uid: ${uid}`);
  
  // Call task service directly
  const response = await fetch('http://localhost:4002/api/v1/book-now/available-leads', {
    headers: {
      'x-user-id': uid,
      'x-profile-id': profileId,
      'x-service-auth': 'ExtraHand_Secure_Token_2024_MinLength32Chars_ChangeInProduction',
      'authorization': 'Bearer dummy-token'
    }
  });
  console.log('Status:', response.status);
  const json = await response.json();
  console.log('Response:', JSON.stringify(json, null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
