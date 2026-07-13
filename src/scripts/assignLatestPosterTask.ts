/**
 * One-off: find latest marketplace task for a poster and accept the sole helper offer
 * (skips payment escrow — for local/test when Neon quota blocks payment).
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/assignLatestPosterTask.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { Database } from '../config/database';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { ApplicationService } from '../services/ApplicationService';

const POSTER_PROFILE_ID = '6a4e6db9ccf78928855c729c';
const POSTER_UID = '2QhjF3V4JjPohy1363mjintWm0j2';

async function main() {
  await Database.connectToDb();

  const latest = await Task.findOne({
    $or: [{ requesterId: POSTER_PROFILE_ID }, { requesterUid: POSTER_UID }],
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!latest) {
    console.log(JSON.stringify({ error: 'No tasks found for poster' }));
    process.exit(1);
  }

  const apps = await TaskApplication.find({ taskId: latest._id }).lean();
  console.log(
    JSON.stringify(
      {
        task: {
          _id: String(latest._id),
          title: latest.title,
          status: latest.status,
          assignmentStatus: latest.assignmentStatus,
          bookingSource: latest.bookingSource,
          requesterId: String(latest.requesterId || ''),
          requesterUid: latest.requesterUid || null,
          assigneeUid: latest.assigneeUid || null,
          assigneeId: latest.assigneeId ? String(latest.assigneeId) : null,
          acceptedApplicationId: latest.acceptedApplicationId
            ? String(latest.acceptedApplicationId)
            : null,
          createdAt: latest.createdAt,
          budget: latest.budget,
        },
        applications: apps.map((a: any) => ({
          _id: String(a._id),
          status: a.status,
          applicantUid: a.applicantUid,
          applicantId: String(a.applicantId || ''),
          applicantName: a.applicantName || a.name || null,
          proposedBudget: a.proposedBudget,
          createdAt: a.createdAt,
        })),
      },
      null,
      2,
    ),
  );

  const pendingOrAccepted = apps.filter((a: any) =>
    ['pending', 'accepted'].includes(a.status),
  );
  const candidates = pendingOrAccepted.length ? pendingOrAccepted : apps;

  if (candidates.length !== 1) {
    console.log(
      JSON.stringify({
        action: 'skip_assign',
        reason:
          candidates.length === 0
            ? 'no_applications'
            : 'expected_exactly_one_helper_app',
        candidateCount: candidates.length,
      }),
    );
    process.exit(candidates.length === 1 ? 0 : 2);
  }

  const app = candidates[0] as any;
  if (
    latest.status === 'assigned' &&
    String(latest.assigneeUid) === String(app.applicantUid)
  ) {
    console.log(
      JSON.stringify({
        action: 'already_assigned',
        helperUid: app.applicantUid,
      }),
    );
    process.exit(0);
  }

  // Marketplace / post-and-choose: accept the application (skips payment escrow).
  const accepted = await ApplicationService.acceptApplication(
    String(app._id),
    new mongoose.Types.ObjectId(POSTER_PROFILE_ID),
    POSTER_UID,
  );

  const updatedTask = await Task.findById(latest._id).lean();

  console.log(
    JSON.stringify(
      {
        action: 'assigned',
        taskId: String(updatedTask?._id || latest._id),
        status: updatedTask?.status,
        assigneeUid: updatedTask?.assigneeUid || null,
        assigneeId: updatedTask?.assigneeId
          ? String(updatedTask.assigneeId)
          : null,
        applicationId: String(accepted._id),
        applicationStatus: accepted.status,
      },
      null,
      2,
    ),
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
