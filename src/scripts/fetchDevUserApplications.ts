/**
 * Debug: fetch applications for Dev User (same query My Work uses: applicantId).
 *
 * Usage:
 *   npx ts-node src/scripts/fetchDevUserApplications.ts
 *   npx ts-node src/scripts/fetchDevUserApplications.ts --task-id=6a3b86316318e5cb304f455f
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Database } from '../config/database';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { ProfileUtils } from '../utils/ProfileUtils';

dotenv.config();

const DEV_PROFILE_ID = '6a1a3f35d65fa9567d77ebde';
const DEV_UID = 'local-test-9999999999';

function parseTaskIdArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--task-id='));
  return arg ? arg.split('=')[1]?.trim() : undefined;
}

async function main() {
  await Database.connectToDb();

  const taskIdFilter = parseTaskIdArg();
  const profileById = await ProfileUtils.getByProfileId(DEV_PROFILE_ID);
  const profileByUid = await ProfileUtils.getProfileIdByUid(DEV_UID);
  const profileFromUid =
    profileByUid != null
      ? await ProfileUtils.getByProfileId(profileByUid)
      : null;

  console.log('\n=== Dev User profile lookup ===');
  console.log('Configured DEV_PROFILE_ID:', DEV_PROFILE_ID);
  console.log('Configured DEV_UID:', DEV_UID);
  console.log('\nBy profile _id:', profileById
    ? {
        _id: String(profileById._id),
        uid: profileById.uid,
        name: ProfileUtils.resolveProfileDisplayName(profileById),
        roles: profileById.roles,
        canAcceptTasks: profileById.roleVerifications?.tasker?.canAcceptTasks,
      }
    : 'NOT FOUND');
  console.log('\nBy uid:', profileFromUid
    ? {
        _id: String(profileFromUid._id),
        uid: profileFromUid.uid,
        name: ProfileUtils.resolveProfileDisplayName(profileFromUid),
        roles: profileFromUid.roles,
      }
    : 'NOT FOUND');

  const profileIdForQuery =
    profileById?._id != null
      ? new mongoose.Types.ObjectId(String(profileById._id))
      : profileFromUid?._id != null
        ? new mongoose.Types.ObjectId(String(profileFromUid._id))
        : new mongoose.Types.ObjectId(DEV_PROFILE_ID);

  if (profileById && profileFromUid && String(profileById._id) !== String(profileFromUid._id)) {
    console.warn(
      '\n⚠️  WARNING: profile _id from DEV_PROFILE_ID does not match profile resolved from DEV_UID.',
    );
  }

  const applicationQuery: Record<string, unknown> = {
    applicantId: profileIdForQuery,
  };
  if (taskIdFilter) {
    applicationQuery.taskId = new mongoose.Types.ObjectId(taskIdFilter);
  }

  console.log('\n=== Applications (mine=true uses applicantId) ===');
  console.log('Query:', {
    applicantId: String(profileIdForQuery),
    ...(taskIdFilter ? { taskId: taskIdFilter } : {}),
  });

  const applications = await TaskApplication.find(applicationQuery)
    .sort({ createdAt: -1 })
    .lean();

  console.log(`Count: ${applications.length}\n`);

  if (applications.length === 0) {
    const byUidOnly = await TaskApplication.find({ applicantUid: DEV_UID })
      .sort({ createdAt: -1 })
      .lean();
    if (byUidOnly.length > 0) {
      console.log(
        `⚠️  Found ${byUidOnly.length} application(s) with applicantUid="${DEV_UID}" but different applicantId:`,
      );
      for (const app of byUidOnly) {
        console.log({
          _id: app._id,
          status: app.status,
          applicantId: app.applicantId,
          applicantUid: app.applicantUid,
          taskId: app.taskId,
        });
      }
      console.log('\nFix: set applicantId on those rows to', String(profileIdForQuery));
    }
  }

  for (const app of applications) {
    const task = await Task.findById(app.taskId)
      .select('title status bookingSource assigneeId assigneeUid acceptedApplicationId')
      .lean();

    const applicantMatchesUid = String(app.applicantUid || '') === DEV_UID;
    const assigneeMatches =
      task?.assigneeId != null &&
      String(task.assigneeId) === String(profileIdForQuery);

    console.log('---');
    console.log({
      applicationId: app._id,
      status: app.status,
      applicantId: app.applicantId,
      applicantUid: app.applicantUid,
      applicantUidMatchesConfig: applicantMatchesUid,
      taskId: app.taskId,
      coverLetter: app.coverLetter,
      proposedBudget: app.proposedBudget,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    });
    console.log('Task:', task
      ? {
          _id: task._id,
          title: task.title,
          status: task.status,
          bookingSource: task.bookingSource,
          assigneeId: task.assigneeId,
          assigneeUid: task.assigneeUid,
          assigneeMatchesApplicant: assigneeMatches,
          acceptedApplicationId: (task as { acceptedApplicationId?: unknown }).acceptedApplicationId,
        }
      : 'TASK NOT FOUND (card hidden in My Work)');
    console.log('My Work would show card:', Boolean(task?.title && String(task.title).trim()));
  }

  console.log('\n=== Tasks assigned to Dev User (assigneeId) ===');
  const assignedTasks = await Task.find({ assigneeId: profileIdForQuery })
    .select('title status bookingSource assigneeUid acceptedApplicationId bookingOrderId')
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();

  console.log(`Count: ${assignedTasks.length}`);
  for (const t of assignedTasks) {
    const hasApp = applications.some(
      (a) => String(a.taskId) === String(t._id) && a.status === 'accepted',
    );
    console.log({
      _id: t._id,
      title: t.title,
      status: t.status,
      bookingSource: t.bookingSource,
      assigneeUid: t.assigneeUid,
      hasAcceptedApplication: hasApp,
      acceptedApplicationId: (t as { acceptedApplicationId?: unknown }).acceptedApplicationId,
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Database.disconnectFromDb();
  });
