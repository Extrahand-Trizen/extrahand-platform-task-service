/**
 * Debug script: Check assigned Book Now tasks for user f81kdwayhkPuc039NXNixBmNI7u2
 * Also tests the /api/v1/book-now/my-leads endpoint directly.
 */
const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');
const axios = require('axios');

const MONGODB_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const TARGET_UID = 'f81kdwayhkPuc039NXNixBmNI7u2';
const TASK_SERVICE_URL = 'http://localhost:4002';
const GATEWAY_URL = 'http://localhost:5000';
const SERVICE_AUTH = 'ExtraHand_Secure_Token_2024_MinLength32Chars_ChangeInProduction';

// Firebase token from the user's logs (may be expired — that's ok, we override auth in task service)
const USER_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjY1Y2IzZjAyMGNhZjdiMmE5ZTg2ZWFkOTAxZDg5ZjQ4MTJjYmFjYmMiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vZXh0cmFoYW5kLWNhMDJjIiwiYXVkIjoiZXh0cmFoYW5kLWNhMDJjIiwiYXV0aF90aW1lIjoxNzg0MDk2MjEyLCJ1c2VyX2lkIjoiZjgxa2R3YXloa1B1YzAzOU5YTml4Qm1OSTd1MiIsInN1YiI6ImY4MWtkd2F5aGtQdWMwMzlOWE5peEJtTkk3dTIiLCJpYXQiOjE3ODQxMDQ4NjQsImV4cCI6MTc4NDEwODQ2NCwicGhvbmVfbnVtYmVyIjoiKzkxODg4ODg4ODg4OCIsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsicGhvbmUiOlsiKzkxODg4ODg4ODg4OCJdfSwic2lnbl9pbl9wcm92aWRlciI6InBob25lIn19.MsaHoL1PzQUq5jPsKX88GkKuFxVzBEcunFg8KtVFZ69i8tilepzZ2hrwYt9ml4s6WaY-JE0RqVATcM532599w7G__FE0JkxTTy-vRW2BGYnHDiIHgHHzTvJcK2tjX7b86lrsyFwZcRDwxJXKPet7J5MMefOjxuPy-v9-KIYXQMxOoMfObgaCM8628sTPb5bnNYffB482yI7KKSMkUcWAgFJySdVy4gwEUGQGRLKFoP5AuS2unDLdT-ul0kTBpr1ZQGaSkiUvZVpDeIQO-wenH6cLolIAbL9nSu_rFaXre384jPMc35FFy0nII5qBpriGJgetESkxT4KkII3wXLasLw';

async function run() {
  console.log('=== DEBUG: Assigned Book Now Tasks for Partner ===\n');

  await mongoose.connect(MONGODB_URI, { dbName: 'extrahand', serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB\n');

  const db = mongoose.connection.db;

  // 1. Find the profile for this UID
  const profile = await db.collection('profiles').findOne({ uid: TARGET_UID });
  if (!profile) {
    console.error('❌ No profile found for uid:', TARGET_UID);
    await mongoose.disconnect();
    return;
  }
  const profileId = profile._id;
  console.log('✅ Profile found:');
  console.log('   _id (profileId):', profileId.toString());
  console.log('   name:', profile.name);
  console.log('   status:', profile.partnerProfile?.status);
  console.log('   roles:', profile.roles);
  console.log('   supplyPrograms:', profile.supplyPrograms);
  console.log('');

  // 2. Check ALL tasks assigned to this partner (any status)
  const allPartnerTasks = await db.collection('tasks').find({
    bookingSource: 'book_now',
    $or: [
      { partnerId: profileId },
      { partnerUid: TARGET_UID },
    ]
  }).toArray();

  console.log(`📋 ALL book_now tasks assigned to this partner (any status): ${allPartnerTasks.length}`);
  allPartnerTasks.forEach(t => {
    console.log(`   - [${t.status}] "${t.title}" id=${t._id} partnerId=${t.partnerId} partnerUid=${t.partnerUid}`);
  });
  console.log('');

  // 3. Check tasks that getMyLeads query would find (status assigned/started/in_progress/review)
  const activeTasks = await db.collection('tasks').find({
    bookingSource: 'book_now',
    partnerId: profileId,
    status: { $in: ['assigned', 'started', 'in_progress', 'review'] },
  }).toArray();

  console.log(`📋 Active leads (assigned/started/in_progress/review): ${activeTasks.length}`);
  activeTasks.forEach(t => {
    console.log(`   - [${t.status}] "${t.title}" id=${t._id}`);
  });
  console.log('');

  // 4. Test task-service /api/v1/book-now/my-leads directly (bypassing gateway auth)
  console.log('🌐 Testing task-service /api/v1/book-now/my-leads directly...');
  try {
    const resp = await axios.get(`${TASK_SERVICE_URL}/api/v1/book-now/my-leads`, {
      headers: {
        'Authorization': `Bearer ${USER_TOKEN}`,
        'X-User-Id': TARGET_UID,
        'X-Profile-Id': profileId.toString(),
        'X-Service-Auth': SERVICE_AUTH,
        'X-Service-Name': 'api-gateway',
        'Content-Type': 'application/json',
      },
    });
    console.log('✅ Task Service Response Status:', resp.status);
    console.log('✅ Task Service Response Data:', JSON.stringify(resp.data, null, 2));
  } catch (err) {
    console.error('❌ Task Service my-leads Error:', err.response?.status, JSON.stringify(err.response?.data));
  }
  console.log('');

  // 5. Test gateway /api/v1/book-now/my-leads (will fail if token expired but shows what gateway does)
  console.log('🌐 Testing GATEWAY /api/v1/book-now/my-leads...');
  try {
    const resp = await axios.get(`${GATEWAY_URL}/api/v1/book-now/my-leads`, {
      headers: {
        'Authorization': `Bearer ${USER_TOKEN}`,
        'X-User-Id': TARGET_UID,
        'Content-Type': 'application/json',
      },
    });
    console.log('✅ Gateway Response Status:', resp.status);
    console.log('✅ Gateway Response Data:', JSON.stringify(resp.data, null, 2));
  } catch (err) {
    console.error('❌ Gateway my-leads Error:', err.response?.status, JSON.stringify(err.response?.data));
  }

  // 6. Check what the acceptLead endpoint expects (profile ID in headers)
  console.log('\n📋 Summary: partner-accept failure root cause:');
  console.log('   The gateway calls forwardUserAuth(userToken) which sets X-Profile-Id only if userToken.profileId is set.');
  console.log('   The gateway resolves profileId by calling user-service getCurrentProfile().');
  console.log('   If user-service fails (401) to call task-service for stats, profileId may still be resolved from profile doc._id.');
  console.log('   Task service acceptLead checks: req.user?.profileId || req.headers["x-profile-id"]');
  console.log('   profileId:', profileId.toString());

  await mongoose.disconnect();
  console.log('\n✅ Done');
}

run().catch(err => {
  console.error('❌ Script error:', err.message);
  process.exit(1);
});
