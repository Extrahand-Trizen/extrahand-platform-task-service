import mongoose from 'mongoose';
import type { ITask } from '../models/Task';
import type { IServiceQuotation } from '../models/ServiceQuotation';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/AppError';

const CONSULTATION_PROJECT_TAX_RATE = Number(
  process.env.CONSULTATION_PROJECT_TAX_RATE || '0.18',
);
const CONSULTATION_PROJECT_WORK_DURATION_MINUTES = Number(
  process.env.CONSULTATION_PROJECT_WORK_DURATION_MINUTES || '60',
);

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ConsultationStageName =
  | 'consultation_booked'
  | 'assessment_submitted'
  | 'quotation_sent'
  | 'quotation_accepted'
  | 'quotation_rejected'
  | 'project_created';

export type AssessmentInput = {
  notes?: string;
  findings?: string[];
  mediaUrls?: string[];
  measurements?: Record<string, unknown>;
  estimateAdjustment?: {
    previousEstimate?: number;
    revisedEstimate?: number;
    currency?: string;
  };
  recommendedLineItems?: Array<{
    code?: string;
    title: string;
    description?: string;
    quantity?: number;
    unit?: string;
    unitRate?: number;
    amount?: number;
    metadata?: Record<string, unknown>;
  }>;
  recommendedScope?: string;
  siteVisitCompletedAt?: string | Date;
};

export type QuotationInput = {
  lineItems: Array<{
    code?: string;
    title: string;
    description?: string;
    quantity?: number;
    unit?: string;
    unitRate?: number;
    amount: number;
    metadata?: Record<string, unknown>;
  }>;
  subtotal?: number;
  gst?: number;
  total?: number;
  scopeSummary?: string;
  notes?: string;
  estimatedTimelineDays?: number;
  preferredStartDate?: string | Date;
  validUntil?: string | Date;
  assessmentId?: string;
};

export type AcceptQuotationInput = {
  projectStartDate?: string | Date;
  projectTitle?: string;
};

export type ConsultationProjectPlan = {
  projectTitle: string;
  description: string;
  startDate?: Date;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: ITask['timeSlot'];
  estimatedDuration?: number;
  assignedProfileId?: mongoose.Types.ObjectId;
  assignedUid?: string | null;
  partnerId?: mongoose.Types.ObjectId | null;
  partnerUid?: string | null;
};

export function normalizeOptionalDate(value?: string | Date): Date | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function asTrimmedArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const result = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return result.length ? result : undefined;
}

export function computeLineItemsSubtotal(
  lineItems: Array<{ amount?: number }>,
): number {
  return Math.round(
    lineItems.reduce((sum, line) => sum + Math.max(0, Number(line.amount) || 0), 0) * 100,
  ) / 100;
}

export function assertConsultationTask(task: ITask | null): ITask {
  if (!task) {
    throw new NotFoundError('Consultation booking not found');
  }
  if (task.bookingKind !== 'consultation' || task.serviceFlowType !== 'consultation_project') {
    throw new BadRequestError('This task is not a consultation booking');
  }
  return task;
}

export function assertConsultationFlowTask(task: ITask | null): ITask {
  if (!task) {
    throw new NotFoundError('Consultation booking not found');
  }
  if (
    task.serviceFlowType !== 'consultation_project' ||
    !['consultation', 'project'].includes(String(task.bookingKind || '').trim())
  ) {
    throw new BadRequestError('This task is not a consultation flow booking');
  }
  return task;
}

export function assertTaskParticipant(task: ITask, actorProfileId: mongoose.Types.ObjectId): void {
  const isRequester = task.requesterId?.equals(actorProfileId);
  const isAssignee = task.assigneeId?.equals(actorProfileId);
  const isPartner = task.partnerId?.equals(actorProfileId);
  if (!isRequester && !isAssignee && !isPartner) {
    throw new ForbiddenError('You do not have access to this consultation');
  }
}

export function assertAssignedPartner(task: ITask, actorProfileId: mongoose.Types.ObjectId): void {
  const isAssigned = task.assigneeId?.equals(actorProfileId) || task.partnerId?.equals(actorProfileId);
  if (!isAssigned) {
    throw new ForbiddenError('Only the assigned consultation partner can update this consultation');
  }
}

export function sanitizeAssessmentInput(input: AssessmentInput) {
  return {
    siteVisitCompletedAt: normalizeOptionalDate(input.siteVisitCompletedAt) || new Date(),
    notes: String(input.notes || '').trim() || undefined,
    findings: asTrimmedArray(input.findings),
    mediaUrls: asTrimmedArray(input.mediaUrls),
    measurements:
      input.measurements && typeof input.measurements === 'object'
        ? input.measurements
        : undefined,
    estimateAdjustment: input.estimateAdjustment,
    recommendedLineItems: Array.isArray(input.recommendedLineItems)
      ? input.recommendedLineItems
          .map((line) => ({
            ...line,
            title: String(line?.title || '').trim(),
            description: String(line?.description || '').trim() || undefined,
            quantity: line?.quantity != null ? Number(line.quantity) : undefined,
            unitRate: line?.unitRate != null ? Number(line.unitRate) : undefined,
            amount: line?.amount != null ? Number(line.amount) : undefined,
          }))
          .filter((line) => line.title)
      : undefined,
    recommendedScope: String(input.recommendedScope || '').trim() || undefined,
    submittedAt: new Date(),
  };
}

export function sanitizeQuotationInput(input: QuotationInput) {
  const lineItems = Array.isArray(input.lineItems)
    ? input.lineItems
        .map((line) => ({
          ...line,
          title: String(line?.title || '').trim(),
          description: String(line?.description || '').trim() || undefined,
          quantity: line?.quantity != null ? Number(line.quantity) : undefined,
          unitRate: line?.unitRate != null ? Number(line.unitRate) : undefined,
          amount: Math.max(0, Number(line?.amount) || 0),
        }))
        .filter((line) => line.title)
    : [];

  if (!lineItems.length) {
    throw new BadRequestError('Quotation must include at least one line item');
  }

  const subtotal =
    input.subtotal != null
      ? Math.max(0, Number(input.subtotal) || 0)
      : computeLineItemsSubtotal(lineItems);
  const normalizedTaxRate =
    Number.isFinite(CONSULTATION_PROJECT_TAX_RATE) && CONSULTATION_PROJECT_TAX_RATE > 0
      ? CONSULTATION_PROJECT_TAX_RATE
      : 0;
  const gst = roundCurrency(subtotal * normalizedTaxRate);
  const total = roundCurrency(subtotal + gst);

  if (input.assessmentId && !mongoose.Types.ObjectId.isValid(input.assessmentId)) {
    throw new BadRequestError('Invalid assessmentId');
  }

  return {
    lineItems,
    subtotal,
    gst,
    total,
    assessmentId:
      input.assessmentId && mongoose.Types.ObjectId.isValid(input.assessmentId)
        ? new mongoose.Types.ObjectId(input.assessmentId)
        : undefined,
    scopeSummary: String(input.scopeSummary || '').trim() || undefined,
    notes: String(input.notes || '').trim() || undefined,
    estimatedTimelineDays:
      input.estimatedTimelineDays != null ? Number(input.estimatedTimelineDays) : undefined,
    preferredStartDate: normalizeOptionalDate(input.preferredStartDate),
    validUntil: normalizeOptionalDate(input.validUntil),
  };
}

function formatCalendarDate(date?: Date): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildConsultationProjectPlan(params: {
  task: ITask;
  quotation: IServiceQuotation;
  projectTitle?: string;
  projectStartDate?: string | Date;
}) {
  const { task, quotation } = params;
  const startDate =
    normalizeOptionalDate(params.projectStartDate) ||
    quotation.preferredStartDate ||
    task.scheduledDate;
  const projectTitle = String(params.projectTitle || '').trim() || `${task.title} Project`;
  const assignedProfileId = task.assigneeId || task.partnerId || undefined;
  const assignedUid = task.assigneeUid || task.partnerUid || undefined;

  return {
    projectTitle,
    description: quotation.scopeSummary || quotation.notes || task.description,
    startDate,
    scheduledDate: formatCalendarDate(startDate),
    scheduledTimeStart: task.scheduledTimeStart,
    scheduledTimeEnd: task.scheduledTimeEnd,
    timeSlot: task.timeSlot,
    // The partner can quote the project timeline in days, but the materialized
    // work task should still use the normal one-time Book Now progress flow.
    estimatedDuration:
      Number.isFinite(CONSULTATION_PROJECT_WORK_DURATION_MINUTES) &&
      CONSULTATION_PROJECT_WORK_DURATION_MINUTES > 0
        ? CONSULTATION_PROJECT_WORK_DURATION_MINUTES
        : task.estimatedDuration,
    assignedProfileId,
    assignedUid: assignedUid || null,
    partnerId: task.partnerId || assignedProfileId || null,
    partnerUid: task.partnerUid || assignedUid || null,
  };
}

export function buildProjectTaskPayload(params: {
  task: ITask;
  quotation: IServiceQuotation;
  projectTitle?: string;
  projectStartDate?: string | Date;
  projectBookingOrderId?: string;
  requesterUid?: string;
}) {
  const { task, quotation } = params;
  const plan = buildConsultationProjectPlan(params);
  const requesterUid = String(params.requesterUid || task.requesterUid || '').trim();
  return {
    title: plan.projectTitle,
    description: plan.description,
    category: task.category,
    categorySlug: task.categorySlug,
    categoryLabel: task.categoryLabel,
    subcategory: task.subcategory,
    budget: {
      amount: quotation.total,
      currency: quotation.currency,
      type: 'fixed' as const,
    },
    isNegotiable: false,
    location: task.location,
    urgency: 'medium' as const,
    priority: 'normal' as const,
    status: plan.assignedProfileId ? ('assigned' as const) : ('open' as const),
    requesterId: task.requesterId,
    requesterUid: requesterUid || undefined,
    assigneeId: plan.assignedProfileId,
    assigneeUid: plan.assignedUid,
    assignedHelperName: task.assignedHelperName || task.assignedToName || task.assigneeName || null,
    assignedToName: task.assignedToName || task.assignedHelperName || null,
    assigneeName: task.assigneeName || task.assignedHelperName || null,
    assignedAt: plan.assignedProfileId ? new Date() : undefined,
    scheduledDate: plan.startDate,
    scheduledTimeStart: plan.scheduledTimeStart,
    scheduledTimeEnd: plan.scheduledTimeEnd,
    timeSlot: plan.timeSlot,
    flexibility: 'strict' as const,
    estimatedDuration: plan.estimatedDuration,
    views: 0,
    isFeatured: false,
    currentRevisionRound: 0,
    negotiationStatus: 'closed' as const,
    bookingSource: task.bookingSource || 'book_now',
    assignmentStatus: plan.assignedProfileId ? ('assigned' as const) : ('pending' as const),
    executionPhase: plan.assignedProfileId ? ('assigned' as const) : undefined,
    serviceFlowType: 'standard' as const,
    bookingKind: 'standard' as const,
    serviceType: task.serviceType,
    partnerId: plan.partnerId,
    partnerUid: plan.partnerUid,
    partnerAcceptedAt: task.partnerAcceptedAt || (plan.assignedProfileId ? new Date() : undefined),
    consultationState: undefined,
  };
}

export function buildConsultationTaskProjectTransitionPatch(params: {
  task: ITask;
  quotation: IServiceQuotation;
  projectTitle?: string;
  projectStartDate?: string | Date;
  projectBookingOrderId?: string;
  bookingItemId?: string;
  requesterUid?: string;
}) {
  const { task, quotation } = params;
  const plan = buildConsultationProjectPlan(params);
  const requesterUid = String(params.requesterUid || task.requesterUid || '').trim() || undefined;
  const subtotal = Math.max(
    0,
    Number(quotation.subtotal || 0) || Number(quotation.total || 0) || 0,
  );

  return {
    title: plan.projectTitle,
    description: plan.description,
    budget: {
      amount: subtotal,
      currency: quotation.currency || 'INR',
      type: 'fixed' as const,
    },
    requesterUid,
    assigneeId: plan.assignedProfileId,
    assigneeUid: plan.assignedUid,
    assignedHelperName: task.assignedHelperName || task.assignedToName || task.assigneeName || null,
    assignedToName: task.assignedToName || task.assignedHelperName || task.assigneeName || null,
    assigneeName: task.assigneeName || task.assignedHelperName || task.assignedToName || null,
    assignedAt: plan.assignedProfileId ? task.assignedAt || new Date() : undefined,
    scheduledDate: plan.startDate,
    scheduledTimeStart: plan.scheduledTimeStart,
    scheduledTimeEnd: plan.scheduledTimeEnd,
    timeSlot: plan.timeSlot,
    estimatedDuration: plan.estimatedDuration,
    bookingOrderId: params.projectBookingOrderId || task.bookingOrderId,
    ...(params.bookingItemId ? { bookingItemId: params.bookingItemId } : {}),
    status: plan.assignedProfileId ? ('assigned' as const) : ('open' as const),
    assignmentStatus: plan.assignedProfileId ? ('assigned' as const) : ('pending' as const),
    executionPhase: plan.assignedProfileId ? ('assigned' as const) : undefined,
    bookingKind: 'project' as const,
    serviceFlowType: 'consultation_project' as const,
    serviceType: task.serviceType,
    partnerId: plan.partnerId,
    partnerUid: plan.partnerUid,
    partnerAcceptedAt: task.partnerAcceptedAt || (plan.assignedProfileId ? new Date() : undefined),
    consultationState: {
      ...task.consultationState,
      currentStage: 'project_created' as const,
      currentQuotationId: quotation._id,
      latestAssessmentId:
        task.consultationState?.latestAssessmentId || quotation.assessmentId || undefined,
      projectTaskId: task._id,
      projectBookingOrderId: params.projectBookingOrderId || task.consultationState?.projectBookingOrderId,
      lastUpdatedAt: new Date(),
    },
  };
}
