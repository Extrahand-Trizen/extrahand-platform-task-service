import mongoose from 'mongoose';
import Task from '../models/Task';
import ConsultationAssessment from '../models/ConsultationAssessment';
import ServiceQuotation from '../models/ServiceQuotation';
import type { ConsultationStageName } from '../utils/consultationProject';
import { buildConsultationFlowPipeline } from './pipelines/buildConsultationFlowPipeline';

export class ConsultationProjectRepository {
  static async findTaskById(taskId: string) {
    return Task.findById(taskId);
  }

  static async getConsultationFlow(taskId: string) {
    const results = await Task.aggregate(
      buildConsultationFlowPipeline(new mongoose.Types.ObjectId(taskId)),
    );
    return results[0] || null;
  }

  static async markTaskStage(
    taskId: string,
    patch: {
      currentStage: ConsultationStageName;
      latestAssessmentId?: mongoose.Types.ObjectId;
      currentQuotationId?: mongoose.Types.ObjectId;
      projectTaskId?: mongoose.Types.ObjectId;
      projectBookingOrderId?: string;
    },
  ): Promise<void> {
    await Task.updateOne(
      { _id: taskId },
      {
        $set: {
          'consultationState.currentStage': patch.currentStage,
          ...(patch.latestAssessmentId
            ? { 'consultationState.latestAssessmentId': patch.latestAssessmentId }
            : {}),
          ...(patch.currentQuotationId
            ? { 'consultationState.currentQuotationId': patch.currentQuotationId }
            : {}),
          ...(patch.projectTaskId
            ? { 'consultationState.projectTaskId': patch.projectTaskId }
            : {}),
          ...(patch.projectBookingOrderId
            ? { 'consultationState.projectBookingOrderId': patch.projectBookingOrderId }
            : {}),
          'consultationState.lastUpdatedAt': new Date(),
        },
      },
    );
  }

  static async createAssessment(payload: Record<string, unknown>) {
    return ConsultationAssessment.create(payload);
  }

  static async getLatestQuotation(taskId: mongoose.Types.ObjectId) {
    return ServiceQuotation.findOne({ consultationTaskId: taskId })
      .sort({ version: -1 })
      .lean();
  }

  static async createQuotation(payload: Record<string, unknown>) {
    return ServiceQuotation.create(payload);
  }

  static async supersedeQuotations(
    consultationTaskId: mongoose.Types.ObjectId,
    excludedQuotationId: mongoose.Types.ObjectId,
    statuses: string[],
  ) {
    await ServiceQuotation.updateMany(
      {
        consultationTaskId,
        _id: { $ne: excludedQuotationId },
        status: { $in: statuses },
      },
      {
        $set: {
          status: 'superseded',
          updatedAt: new Date(),
        },
      },
    );
  }

  static async findQuotationForTask(
    consultationTaskId: mongoose.Types.ObjectId,
    quotationId: mongoose.Types.ObjectId,
  ) {
    return ServiceQuotation.findOne({
      _id: quotationId,
      consultationTaskId,
    });
  }

  static async findProjectTaskById(projectTaskId: mongoose.Types.ObjectId) {
    return Task.findById(projectTaskId).lean();
  }

  static async createProjectTask(payload: Record<string, unknown>) {
    return Task.create(payload);
  }
}
