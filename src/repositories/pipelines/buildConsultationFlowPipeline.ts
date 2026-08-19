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
      $lookup: {
        from: 'profiles',
        let: {
          partnerId: '$partnerId',
          assigneeId: '$assigneeId',
          partnerUid: '$partnerUid',
          assigneeUid: '$assigneeUid',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  {
                    $and: [
                      { $ne: ['$$partnerId', null] },
                      { $eq: ['$_id', '$$partnerId'] },
                    ],
                  },
                  {
                    $and: [
                      { $ne: ['$$assigneeId', null] },
                      { $eq: ['$_id', '$$assigneeId'] },
                    ],
                  },
                  {
                    $and: [
                      { $ne: ['$$partnerUid', null] },
                      { $eq: ['$uid', '$$partnerUid'] },
                    ],
                  },
                  {
                    $and: [
                      { $ne: ['$$assigneeUid', null] },
                      { $eq: ['$uid', '$$assigneeUid'] },
                    ],
                  },
                ],
              },
            },
          },
          { $limit: 1 },
          {
            $project: {
              _id: 1,
              uid: 1,
              name: 1,
              fullName: 1,
              firstName: 1,
              lastName: 1,
              displayName: 1,
              photoURL: 1,
              avatarUrl: 1,
              profileImageUrl: 1,
              rating: 1,
              averageRating: 1,
            },
          },
        ],
        as: '_assignedPartnerProfile',
      },
    },
    {
      $addFields: {
        assignedPartner: {
          $let: {
            vars: {
              profile: { $arrayElemAt: ['$_assignedPartnerProfile', 0] },
            },
            in: {
              profileId: {
                $ifNull: ['$$profile._id', { $ifNull: ['$partnerId', '$assigneeId'] }],
              },
              uid: {
                $ifNull: [
                  '$$profile.uid',
                  { $ifNull: ['$partnerUid', '$assigneeUid'] },
                ],
              },
              name: {
                $ifNull: [
                  '$assigneeName',
                  {
                    $ifNull: [
                      '$assignedHelperName',
                      {
                        $ifNull: [
                          '$assignedToName',
                          {
                            $ifNull: [
                              '$$profile.name',
                              {
                                $ifNull: [
                                  '$$profile.fullName',
                                  {
                                    $concat: [
                                      { $ifNull: ['$$profile.firstName', ''] },
                                      ' ',
                                      { $ifNull: ['$$profile.lastName', ''] },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              photoURL: {
                $ifNull: [
                  '$$profile.photoURL',
                  { $ifNull: ['$$profile.avatarUrl', '$$profile.profileImageUrl'] },
                ],
              },
              rating: {
                $ifNull: ['$$profile.rating', '$$profile.averageRating'],
              },
              assignedAt: {
                $ifNull: ['$partnerAcceptedAt', '$assignedAt'],
              },
            },
          },
        },
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
        assignedPartner: 1,
      },
    },
  ] as mongoose.PipelineStage[];
}
