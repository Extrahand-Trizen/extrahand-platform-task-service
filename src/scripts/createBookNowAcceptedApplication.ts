/**
 * One-off: create accepted TaskApplication for an already-assigned Book Now task
 * so the tasker sees it in My Work.
 *
 * Does NOT change assignee / task status / booking order (task must already be assigned).
 *
 * Usage:
 *   npx ts-node src/scripts/createBookNowAcceptedApplication.ts
 *   npx ts-node src/scripts/createBookNowAcceptedApplication.ts --dry-run
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Database } from '../config/database';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { TaskService } from '../services/TaskService';
import { ProfileUtils } from '../utils/ProfileUtils';

dotenv.config();

const TASK_ID = '6a3bc58dd833cdccfe229044';

/** Used when task.assigneeId / assigneeUid are already set (falls back if missing). */
const FALLBACK_HELPER_PROFILE_ID = '6a21491079e328aec4ab9a8a';
const FALLBACK_HELPER_UID = '3vsCkBGveYdBOQi2PFYLA1yXYcf1';
const FALLBACK_HELPER_NAME = 'C V Tarun';

function taskBudgetAmount(task: { budget?: { amount?: number } | number }): number {
  const budget = task.budget;
  if (budget != null && typeof budget === 'object') {
    const amount = Number(budget.amount);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  if (typeof budget === 'number' && Number.isFinite(budget) && budget > 0) return budget;
  return 0;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await Database.connectToDb();

  const task = await Task.findById(TASK_ID).lean();
  if (!task) {
    throw new Error(`Task not found: ${TASK_ID}`);
  }
  if (task.bookingSource !== 'book_now') {
    throw new Error(`Task ${TASK_ID} is not a Book Now task`);
  }

  const taskStatus = String(task.status || '').toLowerCase();
  if (taskStatus !== 'assigned' && taskStatus !== 'started' && taskStatus !== 'in_progress' && taskStatus !== 'review') {
    throw new Error(
      `Task must already be assigned (status is "${task.status}"). Run assign script first.`,
    );
  }

  const helperProfileId = task.assigneeId
    ? String(task.assigneeId)
    : FALLBACK_HELPER_PROFILE_ID;
  const helperUid = String(task.assigneeUid || '').trim() || FALLBACK_HELPER_UID;

  const helperProfile = await ProfileUtils.getByProfileId(helperProfileId);
  if (!helperProfile) {
    throw new Error(`Helper profile not found: ${helperProfileId}`);
  }

  const helperName =
    ProfileUtils.resolveProfileDisplayName(helperProfile) || FALLBACK_HELPER_NAME;
  const applicantProfile = ProfileUtils.buildSnapshot(helperProfile);

  const amount = taskBudgetAmount(task);
  if (amount <= 0) {
    throw new Error('Task budget amount is missing or invalid');
  }

  const now = new Date();
  const taskObjectId = new mongoose.Types.ObjectId(TASK_ID);
  const helperObjectId = new mongoose.Types.ObjectId(helperProfileId);

  const existingApplication = await TaskApplication.findOne({
    taskId: taskObjectId,
    applicantUid: helperUid,
  });

  const applicationPayload = {
    taskId: taskObjectId,
    applicantId: helperObjectId,
    applicantUid: helperUid,
    applicantProfile: applicantProfile ?? { name: helperName },
    proposedBudget: {
      amount,
      currency: 'INR',
      isNegotiable: false,
    },
    proposedTime: {
      flexible: true,
      estimatedDuration: task.estimatedDuration,
    },
    coverLetter: 'Book Now — assigned by operations',
    status: 'accepted' as const,
    respondedAt: now,
    respondedToRevisionRound: 0,
    taskCurrentRevisionRound: task.currentRevisionRound ?? 0,
    negotiation: {
      initialAmount: amount,
      currentAmount: amount,
      finalAmount: amount,
      status: 'accepted' as const,
      lastActionBy: 'poster' as const,
      history: [
        {
          amount,
          action: 'accept' as const,
          by: 'poster' as const,
          at: now,
        },
      ],
    },
  };

  console.log('Task:', {
    _id: task._id,
    title: task.title,
    status: task.status,
    assigneeId: task.assigneeId,
    assigneeUid: task.assigneeUid,
    acceptedApplicationId: (task as { acceptedApplicationId?: unknown }).acceptedApplicationId,
  });

  console.log('Existing application:', existingApplication
    ? { _id: existingApplication._id, status: existingApplication.status }
    : null);

  console.log('\nPlanned application:', existingApplication
    ? { action: 'update to accepted', _id: existingApplication._id }
    : { action: 'create accepted' });

  console.log('Task link only:', { acceptedApplicationId: '<application _id>' });

  if (dryRun) {
    console.log('\nDry run — no changes written.');
    return;
  }

  let applicationId: mongoose.Types.ObjectId;

  if (existingApplication) {
    Object.assign(existingApplication, applicationPayload);
    existingApplication.updatedAt = now;
    await existingApplication.save();
    applicationId = existingApplication._id as mongoose.Types.ObjectId;
    console.log('\nUpdated application:', String(applicationId));
  } else {
    const created = await TaskApplication.create(applicationPayload);
    applicationId = created._id as mongoose.Types.ObjectId;
    console.log('\nCreated application:', String(applicationId));
  }

  await Task.collection.updateOne(
    { _id: taskObjectId },
    { $set: { acceptedApplicationId: applicationId, updatedAt: now } },
  );

  const superseded = await TaskApplication.updateMany(
    {
      taskId: taskObjectId,
      _id: { $ne: applicationId },
      status: 'accepted',
    },
    { $set: { status: 'rejected', updatedAt: now } },
  );
  if (superseded.modifiedCount > 0) {
    console.log(`\nRejected ${superseded.modifiedCount} previous accepted application(s) for this task.`);
  }

  TaskService.invalidateTaskCache(TASK_ID);

  const updatedApplication = await TaskApplication.findById(applicationId).lean();
  const updatedTask = await Task.findById(TASK_ID).lean();

  console.log('\nDone.');
  console.log('Application:', {
    _id: updatedApplication?._id,
    status: updatedApplication?.status,
    applicantUid: updatedApplication?.applicantUid,
    proposedBudget: updatedApplication?.proposedBudget,
  });
  console.log('Task acceptedApplicationId:', (updatedTask as { acceptedApplicationId?: unknown })?.acceptedApplicationId);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Database.disconnectFromDb();
  });
