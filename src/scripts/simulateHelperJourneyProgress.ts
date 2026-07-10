/**
 * Simulate helper journey APIs against a running task-service (no helper UI).
 *
 * Implemented backend endpoints:
 *   POST /api/v1/tasks/:id/start-otp/send
 *     → helper "start journey": sets executionPhase=on_the_way + generates OTP
 *   POST /api/v1/tasks/:id/execution-phase/arrived
 *     → helper "mark arrived"
 *   GET  /api/v1/tasks/:id/start-otp
 *     → customer reads OTP for Work Progress
 *
 * Prerequisites:
 *   - task-service running on :4002
 *   - task status = assigned with an assignee
 *
 * Usage (from extrahand-platform-task-service):
 *   npx ts-node src/scripts/simulateHelperJourneyProgress.ts --list
 *   npx ts-node src/scripts/simulateHelperJourneyProgress.ts
 *   npx ts-node src/scripts/simulateHelperJourneyProgress.ts --taskId=<TASK_ID>
 *   npx ts-node src/scripts/simulateHelperJourneyProgress.ts --taskId=<TASK_ID> --phase=arrived
 *   npx ts-node src/scripts/simulateHelperJourneyProgress.ts --taskId=<TASK_ID> --phase=read-otp
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import axios from 'axios';
import dns from 'node:dns';

// Match task-service Database workaround for local Windows DNS.
dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config();

const DEFAULT_POSTER_UID = '2QhjF3V4JjPohy1363mjintWm0j2';
const TASK_SERVICE_URL = (process.env.TASK_SERVICE_URL || 'http://127.0.0.1:4002').replace(/\/$/, '');
const SERVICE_AUTH_TOKEN =
  process.env.SERVICE_AUTH_TOKEN ||
  'ExtraHand_Secure_Token_2024_MinLength32Chars_ChangeInProduction';

type Phase = 'on_the_way' | 'arrived' | 'started' | 'submit_proof' | 'read-otp';

function argValue(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length).trim() || undefined;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1].trim();
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function authHeaders(uid: string, profileId: string) {
  return {
    'Content-Type': 'application/json',
    'x-service-auth': SERVICE_AUTH_TOKEN,
    'x-service-name': 'simulate-helper-journey-script',
    'x-user-id': uid,
    'x-profile-id': profileId,
  };
}

async function main() {
  const listOnly = hasFlag('--list');
  const posterUid = argValue('--posterUid') || DEFAULT_POSTER_UID;
  const taskIdArg = argValue('--taskId');
  const phase = (argValue('--phase') || 'on_the_way').toLowerCase() as Phase;

  if (!['on_the_way', 'arrived', 'started', 'submit_proof', 'read-otp'].includes(phase)) {
    throw new Error(`Invalid --phase. Use on_the_way | arrived | started | submit_proof | read-otp`);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI missing in .env');

  console.log('Connecting Mongo…');
  await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB || 'extrahand' });
  console.log('Connected.');
  console.log('Task service:', TASK_SERVICE_URL);

  const Profile = mongoose.connection.collection('profiles');
  const Tasks = mongoose.connection.collection('tasks');

  const poster = await Profile.findOne({ uid: posterUid });
  if (!poster?._id) throw new Error(`Poster profile not found for uid=${posterUid}`);
  const posterProfileId = String(poster._id);
  console.log('Poster:', { uid: posterUid, profileId: posterProfileId });

  if (listOnly) {
    const tasks = await Tasks.find({
      requesterId: new mongoose.Types.ObjectId(posterProfileId),
      status: 'assigned',
      assigneeId: { $ne: null },
    })
      .project({
        title: 1,
        status: 1,
        executionPhase: 1,
        assigneeId: 1,
        assigneeUid: 1,
        assignedAt: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .toArray();

    console.log(`\nAssigned tasks: ${tasks.length}`);
    for (const t of tasks) {
      console.log({
        taskId: String(t._id),
        title: t.title,
        status: t.status,
        executionPhase: t.executionPhase || null,
        assigneeId: t.assigneeId ? String(t.assigneeId) : null,
        assigneeUid: t.assigneeUid || null,
      });
    }
    return;
  }

  let taskId = taskIdArg;
  if (!taskId) {
    const latest = await Tasks.find({
      requesterId: new mongoose.Types.ObjectId(posterProfileId),
      status: 'assigned',
      assigneeId: { $ne: null },
    })
      .sort({ updatedAt: -1 })
      .limit(1)
      .toArray();
    if (!latest[0]?._id) {
      throw new Error('No assigned task found. Use --list or pass --taskId=...');
    }
    taskId = String(latest[0]._id);
    console.log(`Using latest assigned task: ${taskId} (${latest[0].title})`);
  }

  const task = await Tasks.findOne({ _id: new mongoose.Types.ObjectId(taskId) });
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (!task.assigneeId) throw new Error('Task has no assigneeId');

  const helperProfileId = String(task.assigneeId);
  let helperUid = String(task.assigneeUid || '').trim();
  if (!helperUid) {
    const helperProfile = await Profile.findOne({
      _id: new mongoose.Types.ObjectId(helperProfileId),
    });
    helperUid = String(helperProfile?.uid || '').trim();
  }
  if (!helperUid) throw new Error('Could not resolve helper uid');

  console.log('\nTask before:', {
    taskId,
    title: task.title,
    status: task.status,
    executionPhase: task.executionPhase || null,
    helperProfileId,
    helperUid,
  });

  if (phase === 'on_the_way' || phase === 'arrived' || phase === 'started') {
    if (String(task.status).toLowerCase() !== 'assigned' && phase !== 'started') {
      throw new Error(`Need status=assigned (got ${task.status})`);
    }
  }

  if (phase === 'started') {
    let otp = argValue('--otp') || '';
    if (!otp) {
      console.log('\n→ GET start-otp (as poster) to obtain current OTP…');
      const otpRes = await axios.get(`${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/start-otp`, {
        headers: authHeaders(posterUid, posterProfileId),
        validateStatus: () => true,
      });
      otp = String(otpRes.data?.data?.otp || otpRes.data?.otp || '').trim();
      console.log('poster otp response', otpRes.status, JSON.stringify(otpRes.data?.data ?? otpRes.data, null, 2));
    }

    if (!otp) {
      console.log('\n→ No OTP available — sending a fresh one as helper…');
      const sendRes = await axios.post(
        `${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/start-otp/send`,
        {},
        { headers: authHeaders(helperUid, helperProfileId), validateStatus: () => true },
      );
      console.log('send status', sendRes.status, JSON.stringify(sendRes.data, null, 2));
      if (sendRes.status >= 400) {
        throw new Error(sendRes.data?.error || sendRes.data?.message || `HTTP ${sendRes.status}`);
      }
      const otpRes = await axios.get(`${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/start-otp`, {
        headers: authHeaders(posterUid, posterProfileId),
        validateStatus: () => true,
      });
      otp = String(otpRes.data?.data?.otp || otpRes.data?.otp || '').trim();
    }

    if (!otp) throw new Error('Could not resolve OTP to verify');

    console.log(`\n→ POST start-otp/verify (helper enters OTP ${otp} → work started)…`);
    const verifyRes = await axios.post(
      `${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/start-otp/verify`,
      { otp },
      { headers: authHeaders(helperUid, helperProfileId), validateStatus: () => true },
    );
    console.log('response', verifyRes.status, JSON.stringify({
      success: verifyRes.data?.success,
      message: verifyRes.data?.message,
      status: verifyRes.data?.data?.status,
      startedAt: verifyRes.data?.data?.startedAt,
    }, null, 2));
    if (verifyRes.status >= 400) {
      console.log('full error', JSON.stringify(verifyRes.data, null, 2));
      throw new Error(verifyRes.data?.error || verifyRes.data?.message || `HTTP ${verifyRes.status}`);
    }
    console.log('\n✅ Work Started. Refresh customer Work Progress.');
  }

  if (phase === 'submit_proof') {
    if (!['started', 'in_progress', 'review'].includes(String(task.status).toLowerCase())) {
      throw new Error(`Need status=started (got ${task.status})`);
    }

    const proofUrls = [
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&h=400&fit=crop',
      'https://images.unsplash.com/photo-1556911220-bff31c875dbb?w=400&h=400&fit=crop',
    ];

    console.log('\n→ POST submit-proof (helper → review / proof submitted)…');
    const proofRes = await axios.post(
      `${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/submit-proof`,
      { proofUrls, notes: 'Simulated completion proof for Work Progress UI' },
      { headers: authHeaders(helperUid, helperProfileId), validateStatus: () => true },
    );
    console.log('response', proofRes.status, JSON.stringify({
      success: proofRes.data?.success,
      message: proofRes.data?.message,
      status: proofRes.data?.data?.status,
      completionStatus: proofRes.data?.data?.completionStatus,
      proofCount: Array.isArray(proofRes.data?.data?.completionProof)
        ? proofRes.data.data.completionProof.length
        : undefined,
    }, null, 2));
    if (proofRes.status >= 400) {
      console.log('full error', JSON.stringify(proofRes.data, null, 2));
      throw new Error(proofRes.data?.error || proofRes.data?.message || `HTTP ${proofRes.status}`);
    }
    console.log('\n✅ Proof submitted (status=review). Refresh customer Work Progress.');
  }

  if (phase === 'on_the_way' || phase === 'arrived') {
    // Ensure OTP exists for arrived as well (customer shows OTP on arrived).
    if (phase === 'arrived' && !task.executionPhase) {
      console.log('\n→ POST start-otp/send (bootstrap on_the_way + OTP)…');
      const boot = await axios.post(
        `${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/start-otp/send`,
        {},
        { headers: authHeaders(helperUid, helperProfileId), validateStatus: () => true },
      );
      console.log('bootstrap status', boot.status, boot.data);
    }

    if (phase === 'on_the_way') {
      console.log('\n→ POST start-otp/send (helper start journey → OTP)…');
      const res = await axios.post(
        `${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/start-otp/send`,
        {},
        { headers: authHeaders(helperUid, helperProfileId), validateStatus: () => true },
      );
      console.log('response', res.status, JSON.stringify(res.data, null, 2));
      if (res.status >= 400) {
        throw new Error(res.data?.error || res.data?.message || `HTTP ${res.status}`);
      }
    }

    if (phase === 'arrived') {
      console.log('\n→ POST execution-phase/arrived…');
      const res = await axios.post(
        `${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/execution-phase/arrived`,
        {},
        { headers: authHeaders(helperUid, helperProfileId), validateStatus: () => true },
      );
      console.log('response', res.status, JSON.stringify(res.data, null, 2));
      if (res.status >= 400) {
        throw new Error(res.data?.error || res.data?.message || `HTTP ${res.status}`);
      }
    }
  }

  if (phase !== 'started' && phase !== 'submit_proof') {
  console.log('\n→ GET start-otp (as poster / customer)…');
  const otpRes = await axios.get(`${TASK_SERVICE_URL}/api/v1/tasks/${taskId}/start-otp`, {
    headers: authHeaders(posterUid, posterProfileId),
    validateStatus: () => true,
  });
  console.log('response', otpRes.status, JSON.stringify(otpRes.data, null, 2));

  const otpPayload = otpRes.data?.data ?? otpRes.data;
  const otp = otpPayload?.otp;
  if (otp) {
    console.log(`\n✅ Customer OTP: ${otp}`);
    console.log(`   executionPhase: ${otpPayload?.executionPhase}`);
    console.log('Open Work Progress in the customer app and refresh the screen.');
  } else {
    console.log('\n⚠️ No OTP in response. Check status/phase/expiry above.');
  }
  }

  const after = await Tasks.findOne({ _id: new mongoose.Types.ObjectId(taskId) });
  console.log('\nTask after (DB):', {
    status: after?.status,
    completionStatus: after?.completionStatus || null,
    executionPhase: after?.executionPhase || null,
    onTheWayAt: after?.onTheWayAt || null,
    arrivedAt: after?.arrivedAt || null,
    startedAt: after?.startedAt || null,
    reviewAt: after?.reviewAt || null,
    proofCount: Array.isArray(after?.completionProof) ? after.completionProof.length : 0,
    otpExpiresAt: after?.startOtp?.expiresAt || null,
    hasCodePlain: Boolean(after?.startOtp?.codePlain),
  });
}

main()
  .then(async () => {
    await mongoose.disconnect().catch(() => undefined);
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ Failed:', err instanceof Error ? err.message : err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
