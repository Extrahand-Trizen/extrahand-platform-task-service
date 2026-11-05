import crypto from 'crypto';
import TaskStartOtpNotificationJob from '../models/TaskStartOtpNotificationJob';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import { Fast2SMSClient } from '../clients/Fast2SMSClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { NotificationClient } from './NotificationClient';
import logger from '../config/logger';

const MAX_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 1_000;
const LEASE_MS = 60_000;

type StartOtpNotificationInput = {
  jobKey: string;
  taskId: string;
  requesterUid: string;
  requesterEmail?: string;
  requesterPhone?: string;
  requesterName: string;
  taskerName: string;
  taskTitle: string;
  otp: string;
  notificationData: Record<string, unknown>;
  journeyTitle: string;
  journeyBody: string;
};

export function startOtpNotificationRetryDelayMs(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export async function enqueueStartOtpNotifications(input: StartOtpNotificationInput): Promise<void> {
  try {
    await TaskStartOtpNotificationJob.updateOne(
      { jobKey: input.jobKey },
      {
        $setOnInsert: {
          ...input,
          channels: {
            email: { status: input.requesterEmail ? 'pending' : 'delivered' },
            push: { status: 'pending' },
            inApp: { status: 'pending' },
            sms: { status: input.requesterPhone ? 'pending' : 'delivered' },
          },
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    const duplicateKey =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000;
    if (!duplicateKey) throw error;

    const existingJob = await TaskStartOtpNotificationJob.exists({ jobKey: input.jobKey });
    if (!existingJob) throw error;
  }
}

async function deliverJob(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>): Promise<void> {
  const taskData = job.notificationData as Record<string, unknown>;
  const send = async (
    channel: string,
    operation: () => Promise<
      boolean | string | { status: 'unknown'; messageId?: string }
    >,
  ): Promise<void> => {
    if (job.channels[channel]?.status === 'delivered') return;
    await TaskStartOtpNotificationJob.updateOne(
      { _id: job._id },
      { $set: { [`channels.${channel}.status`]: 'processing' } },
    );
    try {
      const result = await operation();
      if (typeof result === 'object' && result.status === 'unknown') {
        await TaskStartOtpNotificationJob.updateOne(
          { _id: job._id },
          {
            $set: {
              [`channels.${channel}.status`]: 'unknown',
              ...(result.messageId ? { [`channels.${channel}.messageId`]: result.messageId } : {}),
            },
          },
        );
        return;
      }
      if (result === false) throw new Error(`${channel} provider rejected delivery`);
      await TaskStartOtpNotificationJob.updateOne(
        { _id: job._id },
        {
          $set: {
            [`channels.${channel}.status`]: 'delivered',
            ...(typeof result === 'string' ? { [`channels.${channel}.messageId`]: result } : {}),
          },
        },
      );
    } catch (error) {
      await TaskStartOtpNotificationJob.updateOne(
        { _id: job._id },
        { $set: { [`channels.${channel}.status`]: 'failed' } },
      );
      throw error;
    }
  };

  await send('email', () =>
    job.requesterEmail
      ? EmailServiceClient.sendTaskStartOtp(job.requesterEmail, {
          requesterName: job.requesterName,
          taskerName: job.taskerName,
          taskTitle: job.taskTitle,
          otp: job.otp,
          userId: job.requesterUid,
        })
      : Promise.resolve(true),
  );
  await send('push', async () =>
    NotificationClient.send({
      eventKey: 'HELPER_ON_THE_WAY',
      category: 'taskUpdates',
      recipients: [job.requesterUid],
      entity: { type: 'task', id: job.taskId },
      title: job.journeyTitle,
      body: job.journeyBody,
      data: taskData,
      eventId: job.jobKey,
    }),
  );
  await send('inApp', () =>
    InAppNotificationClient.send({
      userId: job.requesterUid,
      title: job.journeyTitle,
      body: job.journeyBody,
      type: 'info',
      category: 'taskUpdates',
      data: { ...taskData, eventId: job.jobKey },
    }),
  );
  await send('sms', async () => {
    if (!job.requesterPhone) return true;
    const result = await Fast2SMSClient.sendTaskStartOTP(job.requesterPhone, job.otp, job.taskTitle);
    if (result.status === 'sent') return result.messageId || true;
    if (result.status === 'unknown') return { status: 'unknown' as const };
    throw new Error(`SMS provider ${result.status}`);
  });
}

async function claimJob() {
  const now = new Date();
  return TaskStartOtpNotificationJob.findOneAndUpdate(
    {
      nextAttemptAt: { $lte: now },
      $or: [
        { status: { $in: ['pending', 'retry'] } },
        { status: 'processing', leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: 'processing', leaseUntil: new Date(now.getTime() + LEASE_MS) },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, new: true },
  );
}

async function processOne(): Promise<void> {
  const job = await claimJob();
  if (!job) return;

  try {
    await deliverJob(job);
    await TaskStartOtpNotificationJob.updateOne(
      { _id: job._id },
      { $set: { status: 'completed', leaseUntil: null, lastError: null } },
    );
  } catch (error) {
    const dead = job.attempts >= MAX_ATTEMPTS;
    await TaskStartOtpNotificationJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: dead ? 'dead' : 'retry',
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + startOtpNotificationRetryDelayMs(job.attempts)),
          lastError: error instanceof Error ? error.message : String(error),
        },
      },
    );
    logger.error('Start OTP notification job failed', {
      taskId: job.taskId,
      attempt: job.attempts,
      dead,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let timer: NodeJS.Timeout | undefined;
let processing = false;

export const TaskStartOtpNotificationQueue = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      if (processing) return;
      processing = true;
      void processOne()
        .catch((error) => {
          logger.error('Could not process start OTP notification job', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          processing = false;
        });
    }, POLL_INTERVAL_MS);
    timer.unref();
  },
  stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  },
};

export function createStartOtpNotificationJobKey(taskId: string, requestedAt: Date): string {
  return crypto.createHash('sha256').update(`${taskId}:${requestedAt.toISOString()}`).digest('hex');
}
