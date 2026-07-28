import mongoose from 'mongoose';
import TaskApplication from '../models/TaskApplication';
import { isRecurringVisitPlanTask } from '../utils/recurringVisitMeta';

const OPEN_TASK_STATUSES_FOR_PREVIEW = new Set(['open']);
const MAX_PREVIEW_AVATARS = 4;
const DESCRIPTION_PREVIEW_MAX = 500;

export const MY_TASKS_LIST_SELECT =
  'title description category categorySlug categoryLabel subcategory budget isNegotiable location status urgency priority requesterId assigneeId assignedAt views isFeatured expiresAt scheduledDate dateOption timeSlot flexibility createdAt updatedAt packersMoversDetails groceryPickupDetails medicinePickupDetails pickDropDetails images bookingSource bookingOrderId parentTaskId recurringVisitId recurring recurringPlan activeVisitId tags posterBudgetEditedViaFormOnce currentRevisionRound negotiationStatus budgetRevisions';

export function truncateDescription(description: unknown): string | undefined {
  if (typeof description !== 'string') return undefined;
  const trimmed = description.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= DESCRIPTION_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, DESCRIPTION_PREVIEW_MAX)}…`;
}

export type ApplicationPreview = {
  count: number;
  avatarUrls: string[];
};

export type RecurringSummary = {
  nextVisitDate?: string;
  completedVisitCount: number;
  pendingPaymentVisitId?: string;
  status: string;
};

export async function buildApplicationPreviewsForTasks(
  tasks: Array<{ _id?: mongoose.Types.ObjectId | string; status?: string }>,
): Promise<Map<string, ApplicationPreview>> {
  const previewMap = new Map<string, ApplicationPreview>();

  const openTaskIds = tasks
    .filter((task) => task.status && OPEN_TASK_STATUSES_FOR_PREVIEW.has(task.status))
    .map((task) => task._id)
    .filter((id): id is mongoose.Types.ObjectId | string => Boolean(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (openTaskIds.length === 0) {
    return previewMap;
  }

  const grouped = await TaskApplication.aggregate<{
    _id: mongoose.Types.ObjectId;
    count: number;
    photoUrls: string[];
  }>([
    {
      $match: {
        taskId: { $in: openTaskIds },
        status: 'pending',
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$taskId',
        count: { $sum: 1 },
        photoUrls: {
          $push: {
            $cond: [
              { $ifNull: ['$applicantProfile.photoURL', false] },
              '$applicantProfile.photoURL',
              null,
            ],
          },
        },
      },
    },
  ]);

  for (const row of grouped) {
    const avatarUrls = (row.photoUrls || [])
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .slice(0, MAX_PREVIEW_AVATARS);

    previewMap.set(String(row._id), {
      count: row.count,
      avatarUrls,
    });
  }

  return previewMap;
}

export function buildRecurringSummary(
  task: Record<string, unknown>,
): RecurringSummary | null {
  if (!isRecurringVisitPlanTask(task)) {
    return null;
  }

  const plan = task.recurringPlan as Record<string, unknown> | undefined;
  if (!plan) {
    return null;
  }

  const nextVisitDate =
    plan.nextVisitDate instanceof Date
      ? plan.nextVisitDate.toISOString()
      : typeof plan.nextVisitDate === 'string'
        ? plan.nextVisitDate
        : undefined;

  return {
    nextVisitDate,
    completedVisitCount:
      typeof plan.completedVisitCount === 'number' ? plan.completedVisitCount : 0,
    pendingPaymentVisitId:
      typeof plan.pendingPaymentVisitId === 'string'
        ? plan.pendingPaymentVisitId
        : undefined,
    status: typeof plan.status === 'string' ? plan.status : 'active',
  };
}

export function parseMyTasksInclude(includeRaw: unknown): {
  applicationPreview: boolean;
  recurringSummary: boolean;
} {
  const tokens = new Set(
    String(includeRaw || '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );

  return {
    applicationPreview: tokens.has('applicationpreview'),
    recurringSummary: tokens.has('recurringsummary'),
  };
}
