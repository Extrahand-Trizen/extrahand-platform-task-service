/**
 * Validate embedded schedule[] vs RecurringVisit collection for migrated plans.
 *
 * Usage:
 *   npx ts-node src/scripts/validateRecurringVisitMigration.ts --dry-run
 *   npx ts-node src/scripts/validateRecurringVisitMigration.ts --task-id=<id>
 *   npx ts-node src/scripts/validateRecurringVisitMigration.ts --json
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Task from '../models/Task';
import { Database } from '../config/database';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { getVisitsForPlan } from '../services/RecurringVisitPlanStore';

dotenv.config();

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
    taskId: argv.find((a) => a.startsWith('--task-id='))?.split('=')[1]?.trim(),
    batchSize: Number(argv.find((a) => a.startsWith('--batch-size='))?.split('=')[1] || 50),
  };
}

function compareField(
  mismatches: string[],
  label: string,
  a: unknown,
  b: unknown,
): void {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  if (sa !== sb) mismatches.push(`${label}: embedded=${sa} collection=${sb}`);
}

async function validateTask(task: Record<string, unknown>): Promise<string[]> {
  const mismatches: string[] = [];
  const embedded = Array.isArray(task.schedule) ? task.schedule : [];
  const collection = await RecurringVisitRepository.listByParent(task._id as mongoose.Types.ObjectId);

  if (embedded.length !== collection.length) {
    mismatches.push(`visit count: embedded=${embedded.length} collection=${collection.length}`);
  }

  const collectionByVisitId = new Map(collection.map((v) => [v.visitId, v]));

  for (let i = 0; i < embedded.length; i++) {
    const e = embedded[i] as Record<string, unknown>;
    const visitId = String(e.visitId || '').trim();
    const c = visitId ? collectionByVisitId.get(visitId) : collection[i];
    if (!c) {
      mismatches.push(`missing collection row for embedded index ${i}`);
      continue;
    }
    compareField(mismatches, `visit[${visitId}].status`, e.status, c.status);
    compareField(mismatches, `visit[${visitId}].paymentStatus`, e.paymentStatus, c.paymentStatus);
    compareField(mismatches, `visit[${visitId}].escrowId`, e.escrowId, c.escrowId);
    compareField(mismatches, `visit[${visitId}].childTaskId`, e.childTaskId, c.childTaskId);
    compareField(mismatches, `visit[${visitId}].visitIndex`, e.visitIndex, c.visitIndex);
  }

  const hydrated = await getVisitsForPlan(task as never);
  const pendingEmbedded = embedded.find(
    (r) => (r as { status?: string }).status === 'payment_pending',
  ) as { visitId?: string } | undefined;
  const pendingHydrated = hydrated.find((v) => v.status === 'payment_pending');
  if (String(pendingEmbedded?.visitId || '') !== String(pendingHydrated?.visitId || '')) {
    mismatches.push('pending payment visit mismatch');
  }

  return mismatches;
}

async function main(): Promise<void> {
  const { taskId, batchSize, json } = parseArgs(process.argv.slice(2));
  await Database.connectToDb();

  const filter: Record<string, unknown> = {
    'recurring.enabled': true,
    'recurringPlan.visitStorage': 'collection',
  };
  if (taskId) filter._id = new mongoose.Types.ObjectId(taskId);

  const tasks = await Task.find(filter).limit(batchSize).lean();
  const results: Array<{ taskId: string; mismatches: string[] }> = [];
  let critical = 0;

  for (const task of tasks) {
    const mismatches = await validateTask(task as Record<string, unknown>);
    if (mismatches.length > 0) {
      critical += 1;
      results.push({ taskId: String(task._id), mismatches });
    }
  }

  const summary = {
    checked: tasks.length,
    withMismatches: critical,
    results,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Checked ${summary.checked} plans, ${summary.withMismatches} with mismatches`);
    for (const r of results) {
      console.log(`Task ${r.taskId}:`);
      for (const m of r.mismatches) console.log(`  - ${m}`);
    }
  }

  await mongoose.disconnect();
  process.exit(critical > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
