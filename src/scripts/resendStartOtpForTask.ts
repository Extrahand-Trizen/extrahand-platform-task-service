/**
 * One-off: call requestStartOtp (start-journey OTP send) for a task so poster can see codePlain.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/resendStartOtpForTask.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import crypto from 'crypto';
import { Database } from '../config/database';
import Task from '../models/Task';
import { TaskService } from '../services/TaskService';

const TASK_ID = '6a54769e4417fff05c2082b7';
const HELPER_PROFILE_ID = '6a54770f743cc6f0fc58adb5';
const HELPER_UID = 'f81kdwayhkPuc039NXNixBmNI7u2';
const START_OTP_LENGTH = 4;
const START_OTP_TTL_MS = 10 * 60 * 1000;

function generateStartOtpCode(): string {
  const min = 10 ** (START_OTP_LENGTH - 1);
  const max = 10 ** START_OTP_LENGTH - 1;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

function hashStartOtp(taskId: string, otp: string): string {
  return crypto.createHash('sha256').update(`${taskId}:${otp}`).digest('hex');
}

async function main() {
  await Database.connectToDb();

  const before = await Task.findById(TASK_ID).select('status executionPhase startOtp assigneeId').lean();
  console.log(
    JSON.stringify(
      {
        before: {
          status: before?.status,
          executionPhase: before?.executionPhase,
          hasCodePlain: Boolean((before as any)?.startOtp?.codePlain),
          expiresAt: (before as any)?.startOtp?.expiresAt || null,
        },
      },
      null,
      2,
    ),
  );

  try {
    const result = await TaskService.requestStartOtp(
      TASK_ID,
      new mongoose.Types.ObjectId(HELPER_PROFILE_ID),
      HELPER_UID,
      { isResend: true },
    );

    const after = await Task.findById(TASK_ID).select('status executionPhase startOtp').lean();
    const plain = String((after as any)?.startOtp?.codePlain || '');

    console.log(
      JSON.stringify(
        {
          action: 'requestStartOtp_ok',
          sentTo: result.sentTo,
          expiresAt: result.expiresAt,
          executionPhase: (after as any)?.executionPhase,
          otp: plain,
          hasCodePlain: Boolean(plain),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (err: any) {
    console.warn('requestStartOtp failed, writing fresh OTP directly for test:', err?.message || err);

    const task = await Task.findById(TASK_ID);
    if (!task) throw new Error('Task not found');

    const otp = generateStartOtpCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + START_OTP_TTL_MS);

    task.startOtp = {
      codeHash: hashStartOtp(TASK_ID, otp),
      codePlain: otp,
      requestedAt: now,
      expiresAt,
      attempts: 0,
      resendCount: ((task.startOtp as any)?.resendCount || 0) + 1,
      requestedById: new mongoose.Types.ObjectId(HELPER_PROFILE_ID),
    } as any;

    // Keep arrived so we don't force the user through journey UI again.
    if (!(task as any).executionPhase) {
      (task as any).executionPhase = 'arrived';
    }

    await task.save();

    console.log(
      JSON.stringify(
        {
          action: 'direct_otp_write',
          reason: err?.message || String(err),
          executionPhase: (task as any).executionPhase,
          otp,
          expiresAt,
          hasCodePlain: true,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
