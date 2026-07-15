import mongoose from 'mongoose';
import Task from '../models/Task';
// import TaskQuestion from '../models/TaskQuestion';
import TaskApplication from '../models/TaskApplication';

const GENUINE_STATUSES = ['assigned', 'started', 'in_progress', 'review', 'completed'];

function getRangeStart(range?: string): Date {
  const now = Date.now();
  if (range === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (range === '90d') return new Date(now - 90 * 24 * 60 * 60 * 1000);
  return new Date(now - 30 * 24 * 60 * 60 * 1000);
}

export class AnalyticsService {
  static async getTaskCategoryBreakdown(range?: string): Promise<{
    range: string;
    categories: Array<{
      category: string;
      count: number;
      subcategories: Array<{ subcategory: string; count: number }>;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);

    const [categoriesRaw, subcategoriesRaw] = await Promise.all([
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $project: {
            category: {
              $ifNull: [
                '$categorySlug',
                { $ifNull: ['$categoryLabel', '$category'] },
              ],
            },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$category', 'other'] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $project: {
            category: {
              $ifNull: [
                '$categorySlug',
                { $ifNull: ['$categoryLabel', '$category'] },
              ],
            },
            subcategory: { $ifNull: ['$subcategory', 'unspecified'] },
          },
        },
        {
          $group: {
            _id: {
              category: { $ifNull: ['$category', 'other'] },
              subcategory: { $ifNull: ['$subcategory', 'unspecified'] },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ]);

    const subcategoryMap = new Map<string, Array<{ subcategory: string; count: number }>>();
    for (const row of subcategoriesRaw) {
      const category = row?._id?.category || 'other';
      const subcategory = row?._id?.subcategory || 'unspecified';
      const list = subcategoryMap.get(category) || [];
      list.push({ subcategory, count: Number(row?.count || 0) });
      subcategoryMap.set(category, list);
    }

    const categories = categoriesRaw.map((row) => {
      const category = row?._id || 'other';
      return {
        category,
        count: Number(row?.count || 0),
        subcategories: (subcategoryMap.get(category) || []).slice(0, 10),
      };
    });

    return {
      range: rangeValue,
      categories,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getUserTaskStats(profileId: string, _uid: string): Promise<{
    totalTasks: number;
    completedTasks: number;
    postedTasks: number;
    cancelledTasks: number;
  }> {
    const profileObjectId = new mongoose.Types.ObjectId(profileId);

    const [assigneeStats, posterStats] = await Promise.all([
      Task.aggregate([
        { $match: { assigneeId: profileObjectId } },
        {
          $group: {
            _id: null,
            totalTasks: { $sum: 1 },
            completedTasks: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
            },
            cancelledTasks: {
              $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
            },
          },
        },
      ]),
      Task.aggregate([
        { $match: { requesterId: profileObjectId } },
        { $count: 'postedTasks' },
      ]),
    ]);

    return {
      totalTasks: Number(assigneeStats?.[0]?.totalTasks || 0),
      completedTasks: Number(assigneeStats?.[0]?.completedTasks || 0),
      postedTasks: Number(posterStats?.[0]?.postedTasks || 0),
      cancelledTasks: Number(assigneeStats?.[0]?.cancelledTasks || 0),
    };
  }

  static async getPosterAnalytics(requesterId: string, range?: string): Promise<{
    requesterId: string;
    range: string;
    metrics: {
      postedTasks: number;
      totalBids: number;
      genuineTaskCount: number;
      categories: Array<{ category: string; count: number }>;
    };
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);
    const requesterObjectId = new mongoose.Types.ObjectId(requesterId);

    const [aggregate] = await Task.aggregate([
      {
        $match: {
          requesterId: requesterObjectId,
          createdAt: { $gte: rangeStart },
        },
      },
      {
        $lookup: {
          from: 'taskapplications',
          localField: '_id',
          foreignField: 'taskId',
          as: 'applications',
        },
      },
      {
        $project: {
          category: { $ifNull: ['$categorySlug', '$category'] },
          status: 1,
          bidCount: { $size: '$applications' },
        },
      },
      {
        $facet: {
          metrics: [
            {
              $group: {
                _id: null,
                postedTasks: { $sum: 1 },
                totalBids: { $sum: '$bidCount' },
                genuineTaskCount: {
                  $sum: {
                    $cond: [{ $in: ['$status', GENUINE_STATUSES] }, 1, 0],
                  },
                },
              },
            },
          ],
          categories: [
            {
              $group: {
                _id: { $ifNull: ['$category', 'other'] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $project: { _id: 0, category: '$_id', count: 1 } },
          ],
        },
      },
    ]);

    const metrics = aggregate?.metrics?.[0] || {
      postedTasks: 0,
      totalBids: 0,
      genuineTaskCount: 0,
    };
    const categories = aggregate?.categories || [];

    return {
      requesterId,
      range: rangeValue,
      metrics: {
        postedTasks: metrics.postedTasks || 0,
        totalBids: metrics.totalBids || 0,
        genuineTaskCount: metrics.genuineTaskCount || 0,
        categories,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  static async getPosterSummary(range?: string): Promise<{
    range: string;
    posters: Array<{
      requesterId: string;
      taskCount: number;
      bidCount: number;
      genuineTaskCount: number;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);

    const posters = await Task.aggregate([
      {
        $match: {
          createdAt: { $gte: rangeStart },
        },
      },
      {
        $lookup: {
          from: 'taskapplications',
          localField: '_id',
          foreignField: 'taskId',
          as: 'applications',
        },
      },
      {
        $project: {
          requesterId: 1,
          status: 1,
          bidCount: { $size: '$applications' },
        },
      },
      {
        $group: {
          _id: '$requesterId',
          taskCount: { $sum: 1 },
          bidCount: { $sum: '$bidCount' },
          genuineTaskCount: {
            $sum: {
              $cond: [{ $in: ['$status', GENUINE_STATUSES] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          requesterId: { $toString: '$_id' },
          taskCount: 1,
          bidCount: 1,
          genuineTaskCount: 1,
        },
      },
    ]);

    return {
      range: rangeValue,
      posters,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getTaskCategoryPerformance(range?: string): Promise<{
    range: string;
    totals: {
      posted: number;
      open: number;
      active: number;
      completed: number;
      cancelled: number;
      completionRate: number;
      cancellationRate: number;
    };
    categories: Array<{
      category: string;
      posted: number;
      open: number;
      active: number;
      completed: number;
      cancelled: number;
      completionRate: number;
      cancellationRate: number;
      fulfillmentRate: number;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);
    const activeStatuses = ['assigned', 'started', 'in_progress', 'review'];

    const rows = await Task.aggregate([
      { $match: { createdAt: { $gte: rangeStart } } },
      {
        $project: {
          category: {
            $ifNull: ['$categorySlug', { $ifNull: ['$categoryLabel', '$category'] }],
          },
          status: 1,
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$category', 'other'] },
          posted: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          active: {
            $sum: { $cond: [{ $in: ['$status', activeStatuses] }, 1, 0] },
          },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
      { $sort: { posted: -1 } },
    ]);

    const categories = rows.map((row) => {
      const posted = Number(row?.posted || 0);
      const active = Number(row?.active || 0);
      const completed = Number(row?.completed || 0);
      const cancelled = Number(row?.cancelled || 0);
      const completionRate = posted > 0 ? Number(((completed / posted) * 100).toFixed(1)) : 0;
      const cancellationRate = posted > 0 ? Number(((cancelled / posted) * 100).toFixed(1)) : 0;
      const fulfillmentRate = posted > 0 ? Number((((active + completed) / posted) * 100).toFixed(1)) : 0;

      return {
        category: String(row?._id || 'other'),
        posted,
        open: Number(row?.open || 0),
        active,
        completed,
        cancelled,
        completionRate,
        cancellationRate,
        fulfillmentRate,
      };
    });

    const totals = categories.reduce(
      (acc, category) => {
        acc.posted += category.posted;
        acc.open += category.open;
        acc.active += category.active;
        acc.completed += category.completed;
        acc.cancelled += category.cancelled;
        return acc;
      },
      { posted: 0, open: 0, active: 0, completed: 0, cancelled: 0, completionRate: 0, cancellationRate: 0 }
    );

    totals.completionRate = totals.posted > 0 ? Number(((totals.completed / totals.posted) * 100).toFixed(1)) : 0;
    totals.cancellationRate = totals.posted > 0 ? Number(((totals.cancelled / totals.posted) * 100).toFixed(1)) : 0;

    return {
      range: rangeValue,
      totals,
      categories,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getTaskCancellationAnalytics(range?: string): Promise<{
    range: string;
    totals: {
      totalTasks: number;
      cancelledTasks: number;
      cancellationRate: number;
      cancelledBeforeAssignment: number;
      cancelledAfterAssignment: number;
    };
    trend: Array<{
      date: string;
      totalTasks: number;
      cancelledTasks: number;
      cancellationRate: number;
    }>;
    categories: Array<{
      category: string;
      totalTasks: number;
      cancelledTasks: number;
      cancellationRate: number;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);

    const [summaryRow, categoryRows, trendRows] = await Promise.all([
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $group: {
            _id: null,
            totalTasks: { $sum: 1 },
            cancelledTasks: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
            cancelledBeforeAssignment: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: ['$assigneeId', null] }] },
                  1,
                  0,
                ],
              },
            },
            cancelledAfterAssignment: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'cancelled'] }, { $ne: ['$assigneeId', null] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $project: {
            category: {
              $ifNull: ['$categorySlug', { $ifNull: ['$categoryLabel', '$category'] }],
            },
            status: 1,
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$category', 'other'] },
            totalTasks: { $sum: 1 },
            cancelledTasks: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          },
        },
        { $sort: { totalTasks: -1 } },
      ]),
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $project: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            status: 1,
          },
        },
        {
          $group: {
            _id: '$day',
            totalTasks: { $sum: 1 },
            cancelledTasks: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const summary = summaryRow?.[0] || {};
    const totalTasks = Number(summary.totalTasks || 0);
    const cancelledTasks = Number(summary.cancelledTasks || 0);

    const categories = categoryRows.map((row) => {
      const total = Number(row?.totalTasks || 0);
      const cancelled = Number(row?.cancelledTasks || 0);
      return {
        category: String(row?._id || 'other'),
        totalTasks: total,
        cancelledTasks: cancelled,
        cancellationRate: total > 0 ? Number(((cancelled / total) * 100).toFixed(1)) : 0,
      };
    });

    const trend = trendRows.map((row) => {
      const total = Number(row?.totalTasks || 0);
      const cancelled = Number(row?.cancelledTasks || 0);
      return {
        date: String(row?._id),
        totalTasks: total,
        cancelledTasks: cancelled,
        cancellationRate: total > 0 ? Number(((cancelled / total) * 100).toFixed(1)) : 0,
      };
    });

    return {
      range: rangeValue,
      totals: {
        totalTasks,
        cancelledTasks,
        cancellationRate: totalTasks > 0 ? Number(((cancelledTasks / totalTasks) * 100).toFixed(1)) : 0,
        cancelledBeforeAssignment: Number(summary.cancelledBeforeAssignment || 0),
        cancelledAfterAssignment: Number(summary.cancelledAfterAssignment || 0),
      },
      trend,
      categories,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getUserAnalytics(
    profileId: string,
    uid: string,
    range?: string
  ): Promise<{
    profileId: string;
    uid: string;
    range: string;
    poster: {
      postedTasks: number;
      totalBidsReceived: number;
      tasksWithAtLeastOneBid: number;
      openTasks: number;
      activeTasks: number;
      completedTasks: number;
      questionsAskedOnMyTasks: number;
    };
    tasker: {
      applicationsPlaced: number;
      acceptedApplications: number;
      pendingApplications: number;
      activeAssignedTasks: number;
      completedAssignedTasks: number;
      questionsAsked: number;
      answersGiven: number;
    };
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);
    const profileObjectId = new mongoose.Types.ObjectId(profileId);
    const activeStatuses = ['assigned', 'started', 'in_progress', 'review'];

    const [posterAgg, taskerAgg, applicationAgg] = await Promise.all([
      Task.aggregate([
        { $match: { requesterId: profileObjectId, createdAt: { $gte: rangeStart } } },
        {
          $lookup: {
            from: 'taskapplications',
            localField: '_id',
            foreignField: 'taskId',
            as: 'applications',
          },
        },
        {
          $group: {
            _id: null,
            postedTasks: { $sum: 1 },
            totalBidsReceived: { $sum: { $size: '$applications' } },
            tasksWithAtLeastOneBid: {
              $sum: {
                $cond: [{ $gt: [{ $size: '$applications' }, 0] }, 1, 0],
              },
            },
            openTasks: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
            activeTasks: { $sum: { $cond: [{ $in: ['$status', activeStatuses] }, 1, 0] } },
            completedTasks: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ]),
      Task.aggregate([
        { $match: { assigneeId: profileObjectId, createdAt: { $gte: rangeStart } } },
        {
          $group: {
            _id: null,
            activeAssignedTasks: { $sum: { $cond: [{ $in: ['$status', activeStatuses] }, 1, 0] } },
            completedAssignedTasks: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ]),
      TaskApplication.aggregate([
        { $match: { applicantId: profileObjectId, createdAt: { $gte: rangeStart } } },
        {
          $group: {
            _id: null,
            applicationsPlaced: { $sum: 1 },
            acceptedApplications: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
            pendingApplications: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const poster = posterAgg?.[0] || {};
    const tasker = taskerAgg?.[0] || {};
    const app = applicationAgg?.[0] || {};

    return {
      profileId,
      uid,
      range: rangeValue,
      poster: {
        postedTasks: Number(poster.postedTasks || 0),
        totalBidsReceived: Number(poster.totalBidsReceived || 0),
        tasksWithAtLeastOneBid: Number(poster.tasksWithAtLeastOneBid || 0),
        openTasks: Number(poster.openTasks || 0),
        activeTasks: Number(poster.activeTasks || 0),
        completedTasks: Number(poster.completedTasks || 0),
        questionsAskedOnMyTasks: 0,
      },
      tasker: {
        applicationsPlaced: Number(app.applicationsPlaced || 0),
        acceptedApplications: Number(app.acceptedApplications || 0),
        pendingApplications: Number(app.pendingApplications || 0),
        activeAssignedTasks: Number(tasker.activeAssignedTasks || 0),
        completedAssignedTasks: Number(tasker.completedAssignedTasks || 0),
        questionsAsked: 0,
        answersGiven: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

