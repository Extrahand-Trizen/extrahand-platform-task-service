import mongoose from 'mongoose';
import BookingOrder from '../../models/BookingOrder';
import ConsultationAssessment from '../../models/ConsultationAssessment';
import ServiceQuotation from '../../models/ServiceQuotation';
import Task from '../../models/Task';

const assessmentCollection = ConsultationAssessment.collection.name;
const bookingOrderCollection = BookingOrder.collection.name;
const quotationCollection = ServiceQuotation.collection.name;
const taskCollection = Task.collection.name;

export function buildConsultationFlowPipeline(
  taskId: mongoose.Types.ObjectId,
): mongoose.PipelineStage[] {
  return [
    {
      $match: {
        _id: taskId,
        serviceFlowType: 'consultation_project',
        bookingKind: { $in: ['consultation', 'project'] },
      },
    },
    {
      $lookup: {
        from: assessmentCollection,
        let: { consultationTaskId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$consultationTaskId', '$$consultationTaskId'] },
            },
          },
          { $sort: { createdAt: -1 } },
        ],
        as: 'assessments',
      },
    },
    {
      $lookup: {
        from: quotationCollection,
        let: { consultationTaskId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$consultationTaskId', '$$consultationTaskId'] },
            },
          },
          { $sort: { version: -1, createdAt: -1 } },
        ],
        as: 'quotations',
      },
    },
    {
      $lookup: {
        from: quotationCollection,
        let: { currentQuotationId: '$consultationState.currentQuotationId' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$currentQuotationId'] },
            },
          },
          { $limit: 1 },
        ],
        as: 'currentQuotation',
      },
    },
    {
      $lookup: {
        from: taskCollection,
        let: { projectTaskId: '$consultationState.projectTaskId' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$projectTaskId'] },
            },
          },
          { $limit: 1 },
        ],
        as: 'projectTask',
      },
    },
    {
      $lookup: {
        from: bookingOrderCollection,
        let: { projectBookingOrderId: '$consultationState.projectBookingOrderId' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$orderId', '$$projectBookingOrderId'] },
            },
          },
          { $limit: 1 },
        ],
        as: 'projectBookingOrder',
      },
    },
    {
      $project: {
        consultationTask: '$$ROOT',
        assessments: 1,
        quotations: 1,
        currentQuotation: { $arrayElemAt: ['$currentQuotation', 0] },
        projectTask: { $arrayElemAt: ['$projectTask', 0] },
        projectBookingOrder: { $arrayElemAt: ['$projectBookingOrder', 0] },
      },
    },
  ] as mongoose.PipelineStage[];
}
