/**
 * Idempotent backfill: Task.schedule[] → RecurringVisit collection.
 *
 * Usage:
 *   npx ts-node src/scripts/backfillRecurringVisits.ts --dry-run
 *   npx ts-node src/scripts/backfillRecurringVisits.ts --task-id=<id>
 *   npx ts-node src/scripts/backfillRecurringVisits.ts --batch-size=50
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Task from '../models/Task';
import { Database } from '../config/database';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { mapScheduleRowToUpsert } from '../services/RecurringVisitPlanStore';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';
import { updatePlanSummaryFromVisits } from '../services/RecurringVisitPlanStore';

dotenv.config();

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const taskIdArg = argv.find((a) => a.startsWith('--task-id='));
  const batchArg = argv.find((a) => a.startsWith('--batch-size='));
  return {
    dryRun,
    taskId: taskIdArg ? taskIdArg.split('=')[1]?.trim() : undefined,
    batchSize: batchArg ? Number(batchArg.split('=')[1]) || 50 : 50,
  };
}

function stableLegacyVisitId(taskId: string, rowIndex: number, date: Date): string {
  const key = `${taskId}:${rowIndex}:${new Date(date).toISOString().slice(0, 10)}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  return `legacy_${hash}`;
}

function mapEmbeddedRow(
  taskId: mongoose.Types.ObjectId,
  entry: Record<string, unknown>,
  index: number,
): ScheduleVisitRow {
  const date = new Date(entry.date as Date);
  const visitId =
    typeof entry.visitId === 'string' && entry.visitId.trim()
      ? entry.visitId.trim()
      : stableLegacyVisitId(String(taskId), index, date);

  return {
    visitId,
    visitIndex: typeof entry.visitIndex === 'number' ? entry.visitIndex : index + 1,
    date,
    scheduledTimeStart: entry.scheduledTimeStart as string | undefined,
    scheduledTimeEnd: entry.scheduledTimeEnd as string | undefined,
    expectedDurationMinutes: entry.expectedDurationMinutes as number | undefined,
    status: String(entry.status || 'open'),
    paymentStatus: (entry.paymentStatus || 'not_required') as ScheduleVisitRow['paymentStatus'],
    escrowId: entry.escrowId as string | undefined,
    paymentDeadline: entry.paymentDeadline ? new Date(entry.paymentDeadline as Date) : undefined,
    paidAt: entry.paidAt ? new Date(entry.paidAt as Date) : undefined,
    amount: entry.amount as number | undefined,
    assigneeId: (entry.assigneeId as mongoose.Types.ObjectId) ?? null,
    assigneeUid: (entry.assigneeUid as string) ?? null,
    childTaskId: (entry.childTaskId as mongoose.Types.ObjectId) ?? null,
    skippedAt: entry.skippedAt ? new Date(entry.skippedAt as Date) : undefined,
    skippedBy: entry.skippedBy as string | undefined,
    skipReason: entry.skipReason as string | undefined,
    paymentReminderSentAt: entry.paymentReminderSentAt
      ? new Date(entry.paymentReminderSentAt as Date)
      : undefined,
    cancellationChargeAmount: entry.cancellationChargeAmount as number | undefined,
    rescheduleRequest: entry.rescheduleRequest as ScheduleVisitRow['rescheduleRequest'],
    cancelRequest: entry.cancelRequest as ScheduleVisitRow['cancelRequest'],
    createdAt: entry.createdAt ? new Date(entry.createdAt as Date) : new Date(),
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt as Date) : new Date(),
  };
}

async function backfillTask(
  task: mongoose.Document & Record<string, unknown>,
  dryRun: boolean,
): Promise<{ created: number; updated: number; skipped: number }> {
  const schedule = Array.isArray(task.schedule) ? task.schedule : [];
  if (schedule.length === 0) {
    return { created: 0, updated: 0, skipped: 1 };
  }

  const sorted = [...schedule].sort((a, b) => {
    const da = new Date((a as { date: Date }).date).getTime();
    const db = new Date((b as { date: Date }).date).getTime();
    return da - db;
  });

  const rows = sorted.map((entry, index) =>
    mapEmbeddedRow(task._id as mongoose.Types.ObjectId, entry as Record<string, unknown>, index),
  );

  if (dryRun) {
    console.log(`[dry-run] task ${task._id}: would upsert ${rows.length} visits`);
    return { created: rows.length, updated: 0, skipped: 0 };
  }

  const upserts = rows.map((row) => mapScheduleRowToUpsert(task._id as mongoose.Types.ObjectId, row));
  const result = await RecurringVisitRepository.upsertVisits(upserts);

  const plan = (task.recurringPlan as Record<string, unknown>) || {};
  plan.visitStorage = 'collection';
  if (!plan.planVersion) plan.planVersion = 2;
  await updatePlanSummaryFromVisits(task as never, rows);

  await Task.updateOne(
    { _id: task._id },
    {
      $set: {
        recurringPlan: {
          ...plan,
          visitStorage: 'collection',
        },
      },
    },
  );

  return { created: result.upserted, updated: 0, skipped: 0 };
}

async function main(): Promise<void> {
  const { dryRun, taskId, batchSize } = parseArgs(process.argv.slice(2));
  await Database.connectToDb();

  const filter: Record<string, unknown> = {
    'recurring.enabled': true,
    schedule: { $exists: true, $not: { $size: 0 } },
    $or: [
      { 'recurringPlan.visitStorage': { $ne: 'collection' } },
      { 'recurringPlan.visitStorage': { $exists: false } },
    ],
  };
  if (taskId) {
    filter._id = new mongoose.Types.ObjectId(taskId);
  }

  let scanned = 0;
  let migrated = 0;
  let created = 0;
  let failures = 0;
  let skipped = 0;

  const cursor = Task.find(filter).cursor();
  let batch: (mongoose.Document & Record<string, unknown>)[] = [];

  for await (const doc of cursor) {
    batch.push(doc as unknown as mongoose.Document & Record<string, unknown>);
    if (batch.length >= batchSize) {
      for (const task of batch) {
        scanned += 1;
        try {
          const result = await backfillTask(task, dryRun);
          created += result.created;
          skipped += result.skipped;
          if (result.created > 0 || result.updated > 0) migrated += 1;
        } catch (error) {
          failures += 1;
          console.error(`Failed task ${task._id}:`, error);
        }
      }
      batch = [];
    }
  }

  for (const task of batch) {
    scanned += 1;
    try {
      const result = await backfillTask(task, dryRun);
      created += result.created;
      skipped += result.skipped;
      if (result.created > 0 || result.updated > 0) migrated += 1;
    } catch (error) {
      failures += 1;
      console.error(`Failed task ${task._id}:`, error);
    }
  }

  const summary = { scanned, migrated, created, skipped, failures, dryRun };
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
