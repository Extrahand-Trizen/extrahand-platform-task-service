import mongoose from 'mongoose';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError';
import { ConsultationProjectRepository } from '../repositories/ConsultationProjectRepository';
import type { IConsultationAssessment } from '../models/ConsultationAssessment';
import type { IServiceQuotation } from '../models/ServiceQuotation';
import { BookingService } from './BookingService';
import {
  type AcceptQuotationInput,
  type AssessmentInput,
  type QuotationInput,
  assertAssignedPartner,
  assertConsultationFlowTask,
  assertConsultationTask,
  assertTaskParticipant,
  sanitizeAssessmentInput,
  sanitizeQuotationInput,
} from '../utils/consultationProject';

export class ConsultationProjectService {
  private static isExpiredQuotation(quotation: IServiceQuotation): boolean {
    return Boolean(
      quotation.validUntil &&
        new Date(quotation.validUntil).getTime() < Date.now(),
    );
  }

  static async getConsultationFlow(
    taskId: string,
    actorProfileId: mongoose.Types.ObjectId,
  ) {
    const task = assertConsultationFlowTask(
      await ConsultationProjectRepository.findTaskById(taskId),
    );
    assertTaskParticipant(task, actorProfileId);

    const flow = await ConsultationProjectRepository.getConsultationFlow(taskId);
    if (!flow) {
      throw new NotFoundError('Consultation flow not found');
    }

    return flow;
  }

  static async submitAssessment(
    taskId: string,
    actorProfileId: mongoose.Types.ObjectId,
    actorUid: string,
    input: AssessmentInput,
  ): Promise<IConsultationAssessment> {
    const task = assertConsultationTask(
      await ConsultationProjectRepository.findTaskById(taskId),
    );
    assertAssignedPartner(task, actorProfileId);

    const assessment = await ConsultationProjectRepository.createAssessment({
      consultationTaskId: task._id,
      bookingOrderId: task.bookingOrderId,
      bookingItemId: task.bookingItemId,
      serviceType: task.serviceType,
      requesterId: task.requesterId,
      partnerId: actorProfileId,
      partnerUid: actorUid,
      status: 'submitted',
      ...sanitizeAssessmentInput(input),
    });

    await ConsultationProjectRepository.markTaskStage(taskId, {
      currentStage: 'assessment_submitted',
      latestAssessmentId: assessment._id,
    });

    return assessment;
  }

  static async createQuotation(
    taskId: string,
    actorProfileId: mongoose.Types.ObjectId,
    actorUid: string,
    input: QuotationInput,
  ): Promise<IServiceQuotation> {
    const task = assertConsultationTask(
      await ConsultationProjectRepository.findTaskById(taskId),
    );
    assertAssignedPartner(task, actorProfileId);

    const normalized = sanitizeQuotationInput(input);
    const latest = await ConsultationProjectRepository.getLatestQuotation(task._id);
    const version = (latest?.version || 0) + 1;

    const quotation = await ConsultationProjectRepository.createQuotation({
      consultationTaskId: task._id,
      assessmentId: normalized.assessmentId || task.consultationState?.latestAssessmentId,
      bookingOrderId: task.bookingOrderId,
      bookingItemId: task.bookingItemId,
      requesterId: task.requesterId,
      partnerId: actorProfileId,
      partnerUid: actorUid,
      serviceType: task.serviceType,
      status: 'sent',
      version,
      currency: 'INR',
      subtotal: normalized.subtotal,
      gst: normalized.gst,
      total: normalized.total,
      lineItems: normalized.lineItems,
      scopeSummary: normalized.scopeSummary,
      notes: normalized.notes,
      estimatedTimelineDays: normalized.estimatedTimelineDays,
      preferredStartDate: normalized.preferredStartDate,
      validUntil: normalized.validUntil,
      sentAt: new Date(),
    });

    await ConsultationProjectRepository.supersedeQuotations(
      task._id,
      quotation._id,
      ['draft', 'sent'],
    );

    await ConsultationProjectRepository.markTaskStage(taskId, {
      currentStage: 'quotation_sent',
      currentQuotationId: quotation._id,
    });

    return quotation;
  }

  static async acceptQuotation(
    taskId: string,
    quotationId: string,
    actorProfileId: mongoose.Types.ObjectId,
    input: AcceptQuotationInput,
  ) {
    if (!mongoose.Types.ObjectId.isValid(quotationId)) {
      throw new ConflictError('Invalid quotationId');
    }

    const task = assertConsultationTask(
      await ConsultationProjectRepository.findTaskById(taskId),
    );
    if (!task.requesterId.equals(actorProfileId)) {
      throw new ForbiddenError('Only the customer can accept this quotation');
    }

    const quotationObjectId = new mongoose.Types.ObjectId(quotationId);
    const quotation = await ConsultationProjectRepository.findQuotationForTask(
      task._id,
      quotationObjectId,
    );
    if (!quotation) {
      throw new NotFoundError('Quotation not found');
    }
    if (!['sent', 'accepted'].includes(quotation.status)) {
      throw new ConflictError('Only a sent quotation can be accepted');
    }
    if (this.isExpiredQuotation(quotation)) {
      if (quotation.status !== 'expired') {
        quotation.status = 'expired';
        await quotation.save();
      }
      throw new ConflictError('This quotation has expired. Please request a fresh quotation.');
    }

    if (quotation.projectBookingOrderId) {
      const existingPaymentOrder = await BookingService.createConsultationProjectOrderFromQuotation({
        consultationTask: task as InstanceType<typeof import('../models/Task').default>,
        quotation,
        projectTitle: input.projectTitle,
        projectStartDate: input.projectStartDate,
      });

      await ConsultationProjectRepository.markTaskStage(taskId, {
        currentStage: existingPaymentOrder.task ? 'project_created' : 'quotation_accepted',
        currentQuotationId: quotation._id,
        ...(quotation.projectTaskId ? { projectTaskId: quotation.projectTaskId } : {}),
        ...(quotation.projectBookingOrderId
          ? { projectBookingOrderId: quotation.projectBookingOrderId }
          : {}),
      });
      return {
        quotation,
        ...existingPaymentOrder,
      };
    }

    if (quotation.projectTaskId) {
      const existingProjectTask = await ConsultationProjectRepository.findProjectTaskById(
        quotation.projectTaskId,
      );
      await ConsultationProjectRepository.markTaskStage(taskId, {
        currentStage: 'project_created',
        currentQuotationId: quotation._id,
        projectTaskId: quotation.projectTaskId,
      });
      return { quotation, projectTask: existingProjectTask };
    }

    const projectPaymentOrder = await BookingService.createConsultationProjectOrderFromQuotation({
      consultationTask: task as InstanceType<typeof import('../models/Task').default>,
      quotation,
      projectTitle: input.projectTitle,
      projectStartDate: input.projectStartDate,
    });

    await ConsultationProjectRepository.supersedeQuotations(task._id, quotation._id, ['sent']);

    await ConsultationProjectRepository.markTaskStage(taskId, {
      currentStage: 'quotation_accepted',
      currentQuotationId: quotation._id,
      ...(projectPaymentOrder.order?.orderId
        ? { projectBookingOrderId: projectPaymentOrder.order.orderId }
        : {}),
    });

    return {
      quotation,
      ...projectPaymentOrder,
    };
  }

  static async rejectQuotation(
    taskId: string,
    quotationId: string,
    actorProfileId: mongoose.Types.ObjectId,
    reason?: string,
  ): Promise<IServiceQuotation> {
    if (!mongoose.Types.ObjectId.isValid(quotationId)) {
      throw new ConflictError('Invalid quotationId');
    }

    const task = assertConsultationTask(
      await ConsultationProjectRepository.findTaskById(taskId),
    );
    if (!task.requesterId.equals(actorProfileId)) {
      throw new ForbiddenError('Only the customer can reject this quotation');
    }

    const quotation = await ConsultationProjectRepository.findQuotationForTask(
      task._id,
      new mongoose.Types.ObjectId(quotationId),
    );
    if (!quotation) {
      throw new NotFoundError('Quotation not found');
    }
    if (!['sent', 'accepted'].includes(quotation.status)) {
      throw new ConflictError('Only an active quotation can be rejected');
    }
    if (quotation.projectBookingOrderId) {
      throw new ConflictError(
        'This quotation already has a project payment order. Please contact support for changes.',
      );
    }
    if (quotation.projectTaskId) {
      throw new ConflictError('Accepted quotation is already linked to the existing painting project task');
    }

    quotation.status = 'rejected';
    quotation.rejectedAt = new Date();
    quotation.rejectionReason = String(reason || '').trim() || undefined;
    await quotation.save();

    await ConsultationProjectRepository.markTaskStage(taskId, {
      currentStage: 'quotation_rejected',
      currentQuotationId: quotation._id,
    });

    return quotation;
  }
}
